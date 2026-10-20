import type { SupabaseClient } from '@supabase/supabase-js'
import { deriveChannel } from '@/lib/tracking/ingest'
import { aplicarVinculo } from '@/lib/tracking/identity-apply'
import { sanitizarFbc, sanitizarFbp } from '@/lib/tracking/meta-click'

// Eventos en los que el visitante se identifica (correo/teléfono en properties).
const IDENTITY_EVENTS = new Set(['lead', 'form_submit', 'appointment_booked', 'purchase'])

export type TrackBody = {
  fbc?: string
  fbp?: string
  event?: string
  event_id?: string
  url?: string
  referrer?: string
  anonymous_id?: string
  session_id?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_content?: string
  utm_term?: string
  utm_id?: string
  utm_source_platform?: string
  campaign_id?: string
  adset_id?: string
  ad_id?: string
  gclid?: string
  gbraid?: string
  wbraid?: string
  fbclid?: string
  ttclid?: string
  msclkid?: string
  properties?: Record<string, unknown>
}

export type ResultadoNormalizacion = { status: number; json: Record<string, unknown> }

/**
 * Pasos 5-7 de la ingesta: RAW ya guardado → visitor/session/touchpoint → evento canónico → stitching.
 * Vive aquí para que la ruta de ingesta y el reproceso (app/api/[tenant]/evergreen/tracking/reproceso)
 * ejecuten EXACTAMENTE el mismo código. Es idempotente: el canónico se upserta por
 * (tenant_id, source, source_event_id) y visitor/session/touchpoint son get-or-create.
 */
export async function normalizarEventoRaw(
  sb: SupabaseClient,
  args: {
    tenantId: string
    siteId: string
    rawId: string
    body: TrackBody
    eventName: string
    eventId: string | null
    receivedAt: Date
  }
): Promise<ResultadoNormalizacion> {
  const { tenantId, body, eventName, eventId, receivedAt } = args
  const site = { id: args.siteId }
  const rawRow = { id: args.rawId }
  // 5) Normalización a canónico. Sin anonymous_id no hay visitor: se marca skipped (el raw queda).
  const anonymousId = (body.anonymous_id ?? '').trim().slice(0, 128) || null
  if (!anonymousId) {
    const { error: flagErr } = await sb
      .from('raw_events')
      .update({
        processing_status: 'skipped',
        rejection_reason: 'sin_anonymous_id',
        processed_at: new Date().toISOString(),
      })
      .eq('id', rawRow.id)
    // Si falla, el evento en bruto se queda como 'received' — el replay lo reprocesaría igual
    // (es idempotente), pero el panel de salud contaría trabajo pendiente que ya se resolvió.
    if (flagErr) console.warn(`[track] no se pudo marcar skipped (sin_anonymous_id) ${rawRow.id}:`, flagErr.message)
    return { status: 200, json: { accepted: false, reason: 'sin_anonymous_id' } }
  }

  // 5a) Visitor get-or-create — la unique es (tenant_id, anonymous_id), NUNCA global (migración Fase B).
  let visitorId: string | null = null
  const { data: existingVisitor } = await sb
    .from('analytics_visitors')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('anonymous_id', anonymousId)
    .maybeSingle()
  if (existingVisitor) {
    visitorId = existingVisitor.id
  } else {
    const { data: newVisitor, error: visitorErr } = await sb
      .from('analytics_visitors')
      .insert({ tenant_id: tenantId, anonymous_id: anonymousId })
      .select('id')
      .single()
    if (visitorErr) console.error('[track] no se pudo crear analytics_visitors:', visitorErr.message)
    visitorId = newVisitor?.id ?? null
  }
  if (!visitorId) {
    const { error: flagErr } = await sb
      .from('raw_events')
      .update({ processing_status: 'received', rejection_reason: 'visitor_no_resuelto' })
      .eq('id', rawRow.id)
    if (flagErr) console.warn(`[track] no se pudo anotar visitor_no_resuelto en ${rawRow.id}:`, flagErr.message)
    return { status: 200, json: { accepted: false, reason: 'visitor_no_resuelto' } }
  }

  // 5b) Session get-or-create (30 min de ventana, window name en el SDK).
  const externalSessionId = (body.session_id ?? '').trim().slice(0, 128) || null
  let sessionId: string | null = null
  if (externalSessionId) {
    const { data: existingSession } = await sb
      .from('analytics_sessions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('external_session_id', externalSessionId)
      .maybeSingle()
    if (existingSession) {
      sessionId = existingSession.id
    } else {
      const { data: newSession, error: sessionErr } = await sb
        .from('analytics_sessions')
        .insert({
          tenant_id: tenantId,
          visitor_id: visitorId,
          external_session_id: externalSessionId,
          started_at: receivedAt.toISOString(),
          landing_url: body.url ?? null,
          referrer: body.referrer ?? null,
          utm_source: body.utm_source ?? null,
          utm_medium: body.utm_medium ?? null,
          utm_campaign: body.utm_campaign ?? null,
          utm_content: body.utm_content ?? null,
          utm_term: body.utm_term ?? null,
          gclid: body.gclid ?? null,
          fbclid: body.fbclid ?? null,
          ttclid: body.ttclid ?? null,
          raw_parameters: {
            utm_id: body.utm_id ?? null,
            utm_source_platform: body.utm_source_platform ?? null,
            campaign_id: body.campaign_id ?? null,
            adset_id: body.adset_id ?? null,
            ad_id: body.ad_id ?? null,
            gbraid: body.gbraid ?? null,
            wbraid: body.wbraid ?? null,
            msclkid: body.msclkid ?? null,
            fbc: sanitizarFbc(body.fbc),
            fbp: sanitizarFbp(body.fbp),
          },
        })
        .select('id')
        .single()
      if (sessionErr) console.error('[track] no se pudo crear analytics_sessions:', sessionErr.message)
      sessionId = newSession?.id ?? null
    }
  }

  // 5c) Touchpoint del primer contacto de la sesión (prim-touch attribution).
  let touchpointId: string | null = null
  if (sessionId) {
    const { data: existingTouchpoint } = await sb
      .from('analytics_touchpoints')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('session_id', sessionId)
      .order('occurred_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    touchpointId = existingTouchpoint?.id ?? null
    if (!touchpointId) {
      const { data: newTouchpoint, error: touchpointErr } = await sb
        .from('analytics_touchpoints')
        .insert({
          tenant_id: tenantId,
          visitor_id: visitorId,
          session_id: sessionId,
          occurred_at: receivedAt.toISOString(),
          channel: deriveChannel(body.utm_source, body.referrer),
          source: body.utm_source ?? null,
          medium: body.utm_medium ?? null,
          campaign: body.utm_campaign ?? null,
          landing_url: body.url ?? null,
          referrer: body.referrer ?? null,
          click_id_type: body.gclid
            ? 'gclid'
            : body.gbraid
              ? 'gbraid'
              : body.wbraid
                ? 'wbraid'
                : body.fbclid
                  ? 'fbclid'
                  : body.ttclid
                    ? 'ttclid'
                    : body.msclkid
                      ? 'msclkid'
                      : null,
          click_id: body.gclid ?? body.gbraid ?? body.wbraid ?? body.fbclid ?? body.ttclid ?? body.msclkid ?? null,
          capture_method: 'browser',
          observation_type: 'observed',
          raw_payload: {
            utm_content: body.utm_content ?? null,
            utm_term: body.utm_term ?? null,
            utm_id: body.utm_id ?? null,
            utm_source_platform: body.utm_source_platform ?? null,
            campaign_id: body.campaign_id ?? null,
            adset_id: body.adset_id ?? null,
            ad_id: body.ad_id ?? null,
          },
        })
        .select('id')
        .single()
      if (touchpointErr) console.error('[track] no se pudo crear analytics_touchpoints:', touchpointErr.message)
      touchpointId = newTouchpoint?.id ?? null
    }
  }

  // 6) Evento canónico (idempotente por tenant+source+source_event_id).
  const { error: canonicalError } = await sb.from('canonical_events').upsert(
    {
      tenant_id: tenantId,
      site_id: site.id,
      raw_event_id: rawRow.id,
      source_event_id: eventId,
      event_id: eventId ?? crypto.randomUUID(),
      event_name: eventName,
      occurred_at: receivedAt.toISOString(),
      source: 'pixel',
      schema_version: '1.0',
      idempotency_key: eventId ?? `${anonymousId}:${eventName}:${receivedAt.toISOString()}`,
      visitor_id: visitorId,
      session_id: sessionId,
      touchpoint_id: touchpointId,
      processing_status: 'received',
      properties: {
        url: body.url ?? null,
        referrer: body.referrer ?? null,
        fbc: sanitizarFbc(body.fbc),
        fbp: sanitizarFbp(body.fbp),
        ...(body.properties ?? {}),
      },
    },
    { onConflict: 'tenant_id,source,source_event_id', ignoreDuplicates: true }
  )
  if (canonicalError) {
    const { error: flagErr } = await sb
      .from('raw_events')
      .update({ rejection_reason: `canonico:${canonicalError.code ?? 'error'}` })
      .eq('id', rawRow.id)
    if (flagErr) console.warn(`[track] no se pudo anotar el rechazo canónico en ${rawRow.id}:`, flagErr.message)
    return { status: 500, json: { error: 'No se pudo normalizar el evento' } }
  }

  // 7) Stitching anónimo → contacto. Best-effort: nunca debe tumbar la ingesta (el evento ya está
  // guardado y el replay puede rehacerlo, es idempotente).
  if (IDENTITY_EVENTS.has(eventName)) {
    const props = (body.properties ?? {}) as Record<string, unknown>
    const email = typeof props.email === 'string' ? props.email : null
    const phone = typeof props.phone === 'string' ? props.phone : null
    if (email || phone) {
      try {
        const { data: canonicalRow } = await sb
          .from('canonical_events')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('source', 'pixel')
          .eq('idempotency_key', eventId ?? `${anonymousId}:${eventName}:${receivedAt.toISOString()}`)
          .maybeSingle()
        await aplicarVinculo({
          sb,
          tenantId,
          visitorId,
          canonicalEventId: (canonicalRow as { id: string } | null)?.id ?? null,
          email,
          phone,
        })
      } catch (err) {
        console.warn('[track] stitching de identidad falló:', err instanceof Error ? err.message : err)
      }
    }
  }

  const { error: normalizedErr } = await sb
    .from('raw_events')
    .update({ processing_status: 'normalized', processed_at: new Date().toISOString() })
    .eq('id', rawRow.id)
  // Si falla, el evento se queda como 'received': el replay lo reprocesaría (idempotente por
  // source_event_id), pero es trabajo repetido y el panel de salud daría cifras falsas.
  if (normalizedErr) console.warn(`[track] no se pudo marcar normalized ${rawRow.id}:`, normalizedErr.message)

  return { status: 201, json: { accepted: true } }
}
