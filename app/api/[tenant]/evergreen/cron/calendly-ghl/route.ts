import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncCalendly, syncGhl } from '@/lib/integrations/citas-sync'
import { getTenantConfigWithFallback } from '@/lib/config'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'

export const runtime = 'nodejs'
export const maxDuration = 60

// Es un presupuesto GLOBAL por invocación, no por tenant. Antes cada subcuenta recibía 20 s para
// Calendly + 18 s para GHL: con dos subcuentas la suma teórica ya era 76 s y Vercel podía matar la
// Function aunque cada conector respetase su deadline local. Dejamos 12 s para cold start, config,
// candados de recordSyncRun y serialización de la respuesta.
const REQUEST_WORK_BUDGET_MS = 48_000
const RESPONSE_RESERVE_MS = 4_000
const MIN_JOB_BUDGET_MS = 3_000
const MAX_CALENDLY_BUDGET_MS = 20_000
const MAX_GHL_BUDGET_MS = 18_000

type PreparedTenant = {
  id: string
  slug: string
  cfg: Record<string, string>
}

function providerDeadline(stopAt: number, pendingJobs: number, providerMaxMs: number) {
  const remainingForWork = Math.max(0, stopAt - Date.now() - RESPONSE_RESERVE_MS)
  if (remainingForWork < MIN_JOB_BUDGET_MS) return null
  const fairShare = Math.floor(remainingForWork / Math.max(1, pendingJobs))
  return Date.now() + Math.min(providerMaxMs, Math.max(MIN_JOB_BUDGET_MS, fairShare))
}

// CRON de CITAS (Calendly + GHL): pull diario que completa lo que los webhooks no cubren.
// Por qué existe: la sincronización vivía SOLO en el botón manual de Integraciones › history-sync,
// se usó una vez para la importación inicial y jamás hubo planificador — las agendas nuevas dejaron
// de entrar sin que nadie lo viera (ni un run de estos proveedores en integration_sync_runs en días).
//
// GHL va en modo 'soloEventos': su sync completa lista TODOS los contactos de la ubicación antes de
// tocar eventos (varios minutos con la cuenta actual) — las dos primeras pasadas con la fase completa
// acabaron en 504 y en un run colgado en 'running'. El modo soloEventos salta esa fase, consulta los
// eventos POR VENTANA TEMPORAL (barato) y crea perezosamente solo el contacto de cada evento nuevo.
// La sync completa (contactos + eventos) sigue en el botón de Integraciones (ventana de 5 años).
export async function GET(req: NextRequest) {
  const stopAt = Date.now() + REQUEST_WORK_BUDGET_MS
  const auth = req.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: tenants, error: tenantsErr } = await sb.from('tenants').select('id, slug').eq('status', 'active')
    if (tenantsErr) throw new Error(tenantsErr.message)

    // Presupuesto por subcuenta y POR PROVEEDOR, y POR DEBAJO del corte de Vercel. La suma de
    // los dos deadlines NO puede acercarse a los 60 s del maxDuration: antes del primer fetch ya
    // se gastan cold start, updateSession del middleware, la lectura de tenants y la config por
    // subcuenta, y después quedan por escribir los candados de recordSyncRun. El 25-sep el run
    // diario murió con 504 FUNCTION_INVOCATION_TIMEOUT porque 35+25=60 s exactos no dejaban
    // margen: si ambos proveedores agotan su presupuesto, la respuesta nunca llega. Con 20+18
    // (~38 s de trabajo) queda ~20 s de colchón; un corte por presupuesto NO es un fallo (lo
    // hecho está guardado — upsert idempotente — y el run siguiente continúa).
    const desde = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString()

    const porSubcuenta: Record<string, Record<string, unknown>> = {}
    const preparadas: PreparedTenant[] = []
    for (const tn of tenants || []) {
      if (Date.now() >= stopAt - RESPONSE_RESERVE_MS) {
        porSubcuenta[tn.slug] = { omitida: true, motivo: 'Presupuesto global agotado antes de leer la configuración' }
        continue
      }
      // Config EXPLÍCITA por subcuenta: el token de Calendly de una no puede leer la cuenta de otra.
      const cfg = await getTenantConfigWithFallback(tn.id, true)
      if (!cfg.CALENDLY_API_TOKEN && !cfg.GHL_API_TOKEN) {
        // Sin credencial no es un fallo: esa subcuenta no agenda vía Calendly ni GHL.
        porSubcuenta[tn.slug] = {
          omitida: true,
          motivo: 'Calendly y GHL no están configurados en esta subcuenta',
        }
        continue
      }
      preparadas.push({ id: tn.id, slug: tn.slug, cfg })
      porSubcuenta[tn.slug] = {}
    }

    let pendingJobs = preparadas.reduce(
      (total, tn) => total + Number(Boolean(tn.cfg.CALENDLY_API_TOKEN)) + Number(Boolean(tn.cfg.GHL_API_TOKEN)),
      0
    )

    for (const tn of preparadas) {
      const resultado = porSubcuenta[tn.slug]
      try {
        if (tn.cfg.CALENDLY_API_TOKEN) {
          const deadlineMs = providerDeadline(stopAt, pendingJobs, MAX_CALENDLY_BUDGET_MS)
          pendingJobs--
          if (!deadlineMs) {
            resultado.calendly = {
              omitida: true,
              motivo: 'Presupuesto global agotado; se reintentará en la próxima corrida',
            }
          } else {
            resultado.calendly = await recordSyncRun(
              sb,
              {
                tenantId: tn.id,
                provider: 'calendly',
                job: 'calendly-citas',
                trigger: 'cron',
                secrets: [tn.cfg.CALENDLY_API_TOKEN],
              },
              () => syncCalendly(sb, tn.id, tn.cfg, { desdeInicio: desde, deadlineMs }),
              (r) => ({
                rowsWritten: r.imported + r.updated,
                // Un corte por presupuesto NO es un fallo: es el candado funcionando y queda declarado
                // en detail.cortado. Registrar 'error' aquí falsificaría el panel de salud.
                failures: [],
                detail: {
                  importadas: r.imported,
                  actualizadas: r.updated,
                  closerBackfill: r.closerBackfill,
                  paginas: r.pages,
                  cortado: r.cortado,
                },
              })
            )
          }
        }
        if (tn.cfg.GHL_API_TOKEN) {
          const deadlineMs = providerDeadline(stopAt, pendingJobs, MAX_GHL_BUDGET_MS)
          pendingJobs--
          if (!deadlineMs) {
            resultado.ghl = {
              omitida: true,
              motivo: 'Presupuesto global agotado; se reintentará en la próxima corrida',
            }
          } else {
            resultado.ghl = await recordSyncRun(
              sb,
              {
                tenantId: tn.id,
                provider: 'ghl',
                job: 'ghl-citas',
                trigger: 'cron',
                secrets: [tn.cfg.GHL_API_TOKEN, tn.cfg.GHL_LOCATION_ID],
              },
              () =>
                syncGhl(sb, tn.id, tn.cfg, {
                  desdeInicio: desde,
                  deadlineMs,
                  modo: 'soloEventos',
                }),
              (r) => ({
                rowsWritten: r.appointmentsImported + r.appointmentsUpdated,
                failures: [],
                detail: {
                  citasImportadas: r.appointmentsImported,
                  citasActualizadas: r.appointmentsUpdated,
                  contactos: r.imported + r.updated,
                  closerBackfill: r.closerBackfill,
                  cortado: r.cortado,
                },
              })
            )
          }
        }
      } catch (e) {
        porSubcuenta[tn.slug] = {
          ...resultado,
          error: e instanceof Error ? e.message : 'Error al sincronizar',
          // Otra ejecución ya estaba en marcha: no es un fallo, es el candado funcionando.
          omitida: e instanceof SyncBusyError,
        }
      }
    }
    return NextResponse.json({ desde, subcuentas: porSubcuenta })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
