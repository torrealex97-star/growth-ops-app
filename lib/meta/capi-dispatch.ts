import type { SupabaseClient } from '@supabase/supabase-js'

import { getTenantConfig } from '@/lib/config'
import { capiConfig, construirEventoCapi, enviarEventosCapi, type EventoCapiNombre } from '@/lib/meta/capi'
import { sanitizarFbc, sanitizarFbp } from '@/lib/tracking/meta-click'

// DISPARO AUTOMÁTICO DE LA CONVERSIONS API desde la ingesta del pixel propio.
//
// Solo Lead y Schedule. Purchase NO sale de aquí: una venta es dinero y se decide en el flujo de
// ventas (docs/MONEY.md: booked vs collected, reservas sin completar, reembolsos), no por un evento del
// navegador que cualquiera puede falsificar.
//
// INERTE salvo que la subcuenta tenga Pixel numérico + token + META_CAPI_ENABLED='true' (capiConfig).
// El event_id es el del evento canónico, el mismo que el Pixel del navegador manda como eventID:
// así Meta deduplica en vez de contar doble. Best-effort: un fallo se registra en delivery_attempts y
// nunca rompe la ingesta.

export const EVENTOS_CAPI: Record<string, EventoCapiNombre> = {
  lead: 'Lead',
  appointment_booked: 'Schedule',
}

const TIMEOUT_MS = 5_000

type Args = {
  sb: SupabaseClient
  tenantId: string
  canonicalEventId: string | null
  eventName: string
  /** event_id del navegador (el mismo que recibió el Pixel). */
  eventId: string | null
  receivedAt: Date
  body: {
    url?: string
    fbc?: string
    fbp?: string
    properties?: Record<string, unknown>
  }
  clientIp?: string | null
  userAgent?: string | null
  /** Inyectable en tests; por defecto la configuración de la subcuenta. */
  cargarConfig?: (tenantId: string) => Promise<Record<string, string>>
}

export type ResultadoDespacho =
  | { enviado: false; motivo: 'evento_no_aplica' | 'capi_apagada' | 'sin_event_id' | 'sin_datos_de_contacto' }
  | { enviado: true; ok: boolean; error?: string }

export async function despacharCapi(a: Args): Promise<ResultadoDespacho> {
  const nombre = EVENTOS_CAPI[a.eventName]
  if (!nombre) return { enviado: false, motivo: 'evento_no_aplica' }
  const conf = capiConfig(await (a.cargarConfig ?? getTenantConfig)(a.tenantId))
  if (!conf) return { enviado: false, motivo: 'capi_apagada' }
  // Sin event_id del navegador no hay forma de deduplicar con el Pixel: mejor no enviar que contar doble.
  if (!a.eventId) return { enviado: false, motivo: 'sin_event_id' }

  const props = a.body.properties ?? {}
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  const fbc = sanitizarFbc(a.body.fbc)
  const fbp = sanitizarFbp(a.body.fbp)
  const contacto = {
    email: str(props.email),
    phone: str(props.phone),
    firstName: str(props.first_name),
    lastName: str(props.last_name),
  }
  // Meta exige al menos una señal de emparejamiento; sin ninguna el evento no sirve y solo ensucia.
  if (!contacto.email && !contacto.phone && !fbc && !fbp) return { enviado: false, motivo: 'sin_datos_de_contacto' }

  const evento = construirEventoCapi({
    eventName: nombre,
    eventId: a.eventId,
    eventTime: a.receivedAt,
    url: a.body.url ?? null,
    contacto,
    fbc,
    fbp,
    clientIp: a.clientIp ?? null,
    userAgent: a.userAgent ?? null,
  })
  const t0 = Date.now()
  const r = await enviarEventosCapi(conf, [evento], { timeoutMs: TIMEOUT_MS })

  if (a.canonicalEventId) {
    const { error } = await a.sb.from('delivery_attempts').insert({
      tenant_id: a.tenantId,
      event_id: a.canonicalEventId,
      destination: 'meta_capi',
      status: r.ok ? 'accepted' : 'failed',
      http_status: null,
      latency_ms: Date.now() - t0,
      attempt_number: 1,
      last_error: r.ok ? null : r.error.slice(0, 500),
      response_summary: { fbtrace_id: r.fbtraceId },
      sent_at: new Date().toISOString(),
    })
    if (error) console.warn('[capi] no se pudo registrar delivery_attempts:', error.message)
  }
  return r.ok ? { enviado: true, ok: true } : { enviado: true, ok: false, error: r.error }
}
