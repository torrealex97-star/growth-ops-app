import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'
import { serviceClient } from '@/lib/integrations/citas-sync'
import { backfillAtribucionGhl } from '@/lib/contacts/backfill-atribucion-ghl'

export const runtime = 'nodejs'
export const maxDuration = 60

// BACKFILL DE ATRIBUCIÓN desde la ficha GHL: relee en GHL los contactos cuya atribución primaria
// no tiene evidencia de campaña y registra sus toques first/last (first-wins, idempotente).
// Es el complemento del backfill de custom-fields: mismos mecanismos — candado de sync (job
// dedicado para que correr ambos a la vez no se cancelen entre sí), presupuesto interno muy
// menor que maxDuration (25 s de deadline sobre 60 s de función), idempotencia por fill-if-empty.
//
// Los COMPRADORES (lead_status='venta') van primero: son la cohorte que deja las ventas sin
// atribuir a campaña de Meta, y un corte por presupuesto no debe dejarlos fuera.

const DEADLINE_MS = 25_000

export async function POST(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!['admin', 'director'].includes(t.role || '')) {
    return NextResponse.json({ error: 'Solo admin/director pueden lanzar el backfill' }, { status: 403 })
  }

  const cfg = await getTenantConfigWithFallback(t.tenantId, true)
  const token = cfg.GHL_API_TOKEN
  const locationId = cfg.GHL_LOCATION_ID
  if (!token || !locationId) {
    return NextResponse.json({ error: 'GHL no está configurado en Integraciones (token o location)' }, { status: 400 })
  }

  const sb = serviceClient()
  try {
    const result = await recordSyncRun(
      sb,
      { tenantId: t.tenantId, provider: 'ghl', job: 'ghl-atribucion-backfill', trigger: 'manual', secrets: [token] },
      async () =>
        backfillAtribucionGhl(sb, t.tenantId, {
          token,
          locationId,
          limite: 400,
          deadlineMs: Date.now() + DEADLINE_MS,
        }),
      (r) => ({
        rowsWritten: r.toquesRegistrados,
        detail: {
          contactos_revisados: r.contactosConsiderados,
          contactos_con_nuevos_datos: r.contactosConNuevosDatos,
          toques_registrados: r.toquesRegistrados,
          sin_datos_en_ghl: r.sinDatosGhl,
          cortado_por_presupuesto: r.cortado,
        },
      })
    )
    return NextResponse.json({ provider: 'ghl', ...result })
  } catch (error) {
    if (error instanceof SyncBusyError) return NextResponse.json({ error: error.message }, { status: 409 })
    const msg = error instanceof Error ? error.message : JSON.stringify(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
