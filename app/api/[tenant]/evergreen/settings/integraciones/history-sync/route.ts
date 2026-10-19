import { NextRequest, NextResponse } from 'next/server'
import { type SupabaseClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'

export const runtime = 'nodejs'
export const maxDuration = 60

import { recordSyncRun, SyncBusyError } from '@/lib/integrations/sync-runs'
import { HISTORY_CAPABILITIES } from '@/lib/integrations/history'
// La implementación de las sincronizaciones de citas vive en lib/integrations/citas-sync y la
// ingesta por-reunión de Fathom en lib/fathom/ingesta: las usan también el cron diario y el
// webhook entrante. Aquí solo queda el enrutado de proveedores y la paginación del histórico —
// tener DOS copias de estas funciones (una por el botón, otra por el webhook) es exactamente la
// deriva que dejó la ingesta de agendas muerta durante días sin que nadie la viera.
import { serviceClient, syncCalendly, syncGhl } from '@/lib/integrations/citas-sync'
import { ensureWebhookSubscription } from '@/lib/calendly'
import { encryptSecret, getConfigEncryptionKeyFingerprint, invalidateConfigCache } from '@/lib/config'
import { backfillAtribucionLocal } from '@/lib/contacts/backfill-atribucion'
import { backfillCampaignId } from '@/lib/contacts/backfill-campaign-id'
import { runMetaAdsSync, runMetaDailySync, runMetaSync } from '@/lib/meta/sync'
import { fetchMeetingsPage, meetingId } from '@/lib/fathom/meetings'
import { procesarMeetingFathom } from '@/lib/fathom/ingesta'

async function requireAdmin(tenant: string) {
  const t = await requireTenant(tenant)
  if ('error' in t) return t
  if (!['admin', 'director'].includes(t.role || '')) {
    return { error: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) }
  }
  return t
}

async function syncFathom(
  sb: SupabaseClient,
  tenantId: string,
  cfg: Record<string, string>,
  opts: { dryRun?: boolean } = {}
) {
  const key = cfg.FATHOM_API_KEY
  if (!key) throw new Error('Falta FATHOM_API_KEY')
  const dryRun = opts.dryRun === true
  let cursor = ''
  let pages = 0
  const stats = {
    emparejadas: 0,
    ya_importadas: 0,
    a_revision_ambiguas: 0,
    a_revision_sin_candidatos: 0,
    // Ya estaban en la cola de una pasada anterior: ni se reprocesan ni se vuelven a anotar.
    ya_en_revision: 0,
    sin_identificador: 0,
  }
  // Muestra de lo que haría, para que el dry-run sea legible y no solo un recuento.
  const muestra: Array<{ reunion: string; decision: string; detalle?: string }> = []

  while (pages < 100) {
    const { items, nextCursor } = await fetchMeetingsPage(key, cursor)

    for (const meeting of items) {
      const fathomMeetingId = meetingId(meeting)
      if (!fathomMeetingId) {
        // Sin identificador estable no hay forma de ser idempotente ni de anotar el caso en la cola
        // sin duplicarlo en cada pasada, así que se cuenta y se deja fuera.
        stats.sin_identificador++
        continue
      }

      const resultado = await procesarMeetingFathom(sb, tenantId, meeting, { dryRun })
      // Los contadores y las escrituras los lleva la ingesta por reunión (misma lógica que usa el
      // webhook entrante): aquí solo se anotan, con el porqué en la muestra cuando el caso acaba
      // en la cola de revisión.
      if (resultado.kind === 'ya_en_revision') stats.ya_en_revision++
      if (resultado.kind === 'ya_importadas') stats.ya_importadas++
      if (resultado.kind === 'emparejadas') {
        stats.emparejadas++
        if (muestra.length < 20)
          muestra.push({ reunion: fathomMeetingId, decision: `emparejada (${resultado.via ?? 'via'})` })
      }
      if (resultado.kind === 'a_revision_ambiguas') {
        stats.a_revision_ambiguas++
        if (muestra.length < 20)
          muestra.push({ reunion: fathomMeetingId, decision: 'ambigua', detalle: resultado.razon })
      }
      if (resultado.kind === 'a_revision_sin_candidatos') {
        stats.a_revision_sin_candidatos++
        if (muestra.length < 20)
          muestra.push({ reunion: fathomMeetingId, decision: 'sin_candidatos', detalle: resultado.razon })
      }
    }

    pages++
    cursor = nextCursor
    if (!cursor) break
  }

  return { provider: 'fathom', dryRun, pages, ...stats, muestra }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = await requireAdmin(tenant)
    if ('error' in auth) return auth.error
    const body = (await req.json().catch(() => ({}))) as {
      provider?: string
      dryRun?: boolean
      cursor?: string
      limite?: number
    }
    const cfg = await getTenantConfigWithFallback(auth.tenantId, true)
    const sb = serviceClient()
    // Meta se carga desde aquí para que el histórico entre por el mismo sitio que el resto: primero
    // las campañas, y después el gasto día a día pidiendo el MÁXIMO que Meta conserva (37 meses) en
    // vez de los 180 días del sync rutinario. Es una carga puntual que el usuario ha pedido
    // explícitamente, así que traer poco sería lo único que no tiene sentido.
    if (body.provider === 'meta') {
      // Credenciales EXPLÍCITAS de esta subcuenta (`cfg`). Antes esto llamaba a ensureConfig(), que
      // vuelca la config en process.env y deja ahí las credenciales de la última subcuenta que pasó
      // por la lambda; con la config pasada como argumento, lo que se sincroniza es lo guardado aquí.
      const dias = HISTORY_CAPABILITIES.meta.sinceDays
      const secrets = [cfg.META_ACCESS_TOKEN, cfg.META_APP_SECRET]
      const campañas = await recordSyncRun(
        sb,
        { tenantId: auth.tenantId, provider: 'meta', job: 'meta', trigger: 'historico', secrets },
        () => runMetaSync(sb, auth.tenantId, cfg),
        (r) => ({ rowsWritten: r.synced, failures: r.failures, detail: { cuentas: r.accounts } })
      )
      const diario = await recordSyncRun(
        sb,
        { tenantId: auth.tenantId, provider: 'meta', job: 'meta-daily', trigger: 'historico', secrets },
        () => runMetaDailySync(sb, auth.tenantId, cfg, dias),
        (r) => ({ rowsWritten: r.daysSynced, failures: r.failures, detail: { cuentas: r.accounts, dias } })
      )
      const anuncios = await recordSyncRun(
        sb,
        { tenantId: auth.tenantId, provider: 'meta', job: 'meta-ads', trigger: 'historico', secrets },
        () => runMetaAdsSync(sb, auth.tenantId, cfg),
        (r) => ({ rowsWritten: r.adsSynced, failures: r.failures, detail: { cuentas: r.accounts } })
      )
      return NextResponse.json({ provider: 'meta', campañas, diario, anuncios, sinceDays: dias })
    }
    if (body.provider === 'ghl') {
      // Igual que Calendly: el histórico completo no cabe en una Function Hobby de 60 s.
      // Procesamos eventos y sus contactos asociados durante ~40 s y devolvemos un cursor
      // reanudable. Lo ya escrito queda persistido e idempotente por external_id.
      const cursor = typeof body.cursor === 'string' && body.cursor.length <= 2048 ? body.cursor : undefined
      const result = await recordSyncRun(
        sb,
        {
          tenantId: auth.tenantId,
          provider: 'ghl',
          job: 'ghl-historico',
          trigger: 'historico',
          secrets: [cfg.GHL_API_TOKEN],
          requiere: { claves: ['GHL_API_TOKEN', 'GHL_LOCATION_ID'], cfg },
        },
        () =>
          syncGhl(sb, auth.tenantId, cfg, {
            modo: 'soloEventos',
            pageToken: cursor,
            deadlineMs: Date.now() + 40_000,
          }),
        (r) => ({
          rowsWritten: r.appointmentsImported + r.appointmentsUpdated,
          failures: [],
          detail: {
            citasImportadas: r.appointmentsImported,
            citasActualizadas: r.appointmentsUpdated,
            contactosImportados: r.imported,
            contactosActualizados: r.updated,
            closerBackfill: r.closerBackfill,
            tieneSiguienteLote: Boolean(r.nextPageToken),
          },
        })
      )
      return NextResponse.json(result)
    }
    if (body.provider === 'calendly') {
      // El histórico completo son cientos de llamadas (evento + invitees + escrituras). Hacerlo
      // dentro de UNA función de 60 s terminaba en 504 y obligaba a recargar. Se procesa una página
      // pequeña por petición y la UI continúa con el cursor opaco de Calendly. Cada lote queda
      // registrado y es idempotente; si la red se corta, se reintenta el mismo cursor sin duplicar.
      const cursor = typeof body.cursor === 'string' && body.cursor.length <= 2048 ? body.cursor : undefined
      const result = await recordSyncRun(
        sb,
        {
          tenantId: auth.tenantId,
          provider: 'calendly',
          job: 'calendly-historico',
          trigger: 'historico',
          secrets: [cfg.CALENDLY_API_TOKEN],
          requiere: { claves: ['CALENDLY_API_TOKEN'], cfg },
        },
        () => syncCalendly(sb, auth.tenantId, cfg, { pageToken: cursor, maxPages: 1, pageSize: 20 }),
        (r) => ({
          rowsWritten: r.imported + r.updated,
          failures: [],
          detail: {
            importadas: r.imported,
            actualizadas: r.updated,
            closerBackfill: r.closerBackfill,
            tieneSiguienteLote: Boolean(r.nextPageToken),
          },
        })
      )
      return NextResponse.json(result)
    }
    if (body.provider === 'calendly-webhook') {
      // Acción de una sola vez, no un sync de datos: crea (o recrea si Calendly la desactivó)
      // la suscripción del webhook en tiempo real del lado de Calendly. Sin esto, las citas solo
      // entraban por el cron diario de respaldo (calendly-citas) — nunca hubo suscripción real.
      if (!cfg.CALENDLY_API_TOKEN) return NextResponse.json({ error: 'Falta CALENDLY_API_TOKEN' }, { status: 400 })
      if (!cfg.CALENDLY_WEBHOOK_SECRET)
        return NextResponse.json({ error: 'Falta CALENDLY_WEBHOOK_SECRET' }, { status: 400 })
      const site = (process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin).replace(/\/$/, '')
      const callbackUrl = `${site}/api/${tenant}/evergreen/webhooks/calendly`
      const resultado = await ensureWebhookSubscription(
        cfg.CALENDLY_API_TOKEN,
        callbackUrl,
        cfg.CALENDLY_WEBHOOK_SECRET
      )
      if (resultado.signingKeyNueva) {
        // Calendly generó su propia signing_key en vez de aceptar la nuestra: hay que guardar ESA
        // o verifySignature() del webhook rechazará todas las entregas reales por firma inválida.
        const { error: errSecret } = await sb.from('integration_settings').upsert(
          {
            tenant_id: auth.tenantId,
            key: 'CALENDLY_WEBHOOK_SECRET',
            value: encryptSecret(resultado.signingKeyNueva),
            is_secret: true,
            key_fingerprint: getConfigEncryptionKeyFingerprint(),
            updated_by: auth.userId,
          },
          { onConflict: 'tenant_id,key' }
        )
        if (errSecret) return NextResponse.json({ error: errSecret.message }, { status: 500 })
        invalidateConfigCache(auth.tenantId)
      }
      return NextResponse.json({ provider: 'calendly-webhook', callbackUrl, ...resultado })
    }
    if (body.provider === 'fathom')
      return NextResponse.json(await syncFathom(sb, auth.tenantId, cfg, { dryRun: body.dryRun === true }))
    if (body.provider === 'atribucion') {
      // Backfill LOCAL de atribución: no sale a ningún proveedor; rellena el primer toque de los
      // contactos cuyo origen quedó guardado solo en la cita (appointments.utm_*) y nunca llegó a
      // contact_attributions por el bug histórico. Idempotente y acotado primero-wins: no toca
      // contactos ya atribuidos ni inventa orígenes. Reutiliza recordSyncRun para que la pasada
      // quede en el historial y el panel pueda decir cuándo se corrió y qué escribió.
      const limite =
        typeof body.limite === 'number' && Number.isFinite(body.limite) ? Math.round(body.limite) : undefined
      const result = await recordSyncRun(
        sb,
        { tenantId: auth.tenantId, provider: 'atribucion', job: 'atribucion-backfill', trigger: 'historico' },
        () => backfillAtribucionLocal(sb, auth.tenantId, limite !== undefined ? { limite } : {}),
        (r) => ({
          rowsWritten: r.toquesCreados + r.toquesActualizados,
          failures: r.errores,
          detail: {
            contactosConsiderados: r.contactosConsiderados,
            toquesCreados: r.toquesCreados,
            toquesActualizados: r.toquesActualizados,
            sinDatos: r.sinDatos,
          },
        })
      )
      return NextResponse.json({ provider: 'atribucion', ...result })
    }
    if (body.provider === 'campañas') {
      // Aliasing utm_campaign ↔ campaigns de la subcuenta: rellena contacts.campaign_id SOLO en
      // huecos (contactos ya asignados no se tocan). Orgánicas quedan SIN campaña a conciencia;
      // sin match o ambiguo se REPORTA para revisión sin escribir — no inventar correspondencias.
      const limite =
        typeof body.limite === 'number' && Number.isFinite(body.limite) ? Math.round(body.limite) : undefined
      const result = await recordSyncRun(
        sb,
        { tenantId: auth.tenantId, provider: 'campañas', job: 'campaign-id-backfill', trigger: 'historico' },
        () => backfillCampaignId(sb, auth.tenantId, limite !== undefined ? { limite } : {}),
        (r) => ({
          rowsWritten: r.asignados,
          failures: r.errores,
          detail: {
            contactosConsiderados: r.contactosConsiderados,
            asignados: r.asignados,
            organicas: r.organicas,
            sinMatch: r.sinMatch,
            ambiguas: r.ambiguas,
            ejemplosSinMatch: r.ejemplos,
          },
        })
      )
      return NextResponse.json({ provider: 'campañas', ...result })
    }
    return NextResponse.json({ error: 'Proveedor no soportado' }, { status: 400 })
  } catch (error) {
    if (error instanceof SyncBusyError) return NextResponse.json({ error: error.message }, { status: 409 })
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
