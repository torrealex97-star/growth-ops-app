import crypto from 'crypto'

import { graphUrl, META_API_VERSION } from '@/lib/meta/api-version'

// META CONVERSIONS API (CAPI) — envío server-side de Lead/Schedule/Purchase a Meta.
// Patrón tomado de los destinos open source de Facebook Conversions API de RudderStack y Jitsu:
// PII normalizada y hasheada con SHA-256, fbc/fbp tal cual (NO se hashean), event_id para deduplicar
// contra el Pixel del navegador, y action_source explícito.
//
// INERTE POR DEFECTO. Nada de aquí se ejecuta solo: `capiConfig` devuelve null salvo que la subcuenta
// tenga META_PIXEL_ID, un token Y haya activado META_CAPI_ENABLED a propósito. Mientras no se conecte
// a un disparador real, la única vía de envío es la ruta de prueba, que exige un test_event_code
// (los eventos de prueba no llegan a las métricas de producción).

export type EventoCapiNombre = 'Lead' | 'Schedule' | 'Purchase' | 'CompleteRegistration'

export type DatosContactoCapi = {
  email?: string | null
  phone?: string | null
  firstName?: string | null
  lastName?: string | null
  country?: string | null
  /** Identificador propio estable (p. ej. el id del contacto). Mejora el emparejamiento. */
  externalId?: string | null
}

export type EventoCapiEntrada = {
  eventName: EventoCapiNombre
  /** Mismo valor que el `eventID` del Pixel del navegador si ambos disparan: Meta deduplica por él. */
  eventId: string
  eventTime: Date
  url?: string | null
  contacto: DatosContactoCapi
  fbc?: string | null
  fbp?: string | null
  clientIp?: string | null
  userAgent?: string | null
  value?: number | null
  currency?: string | null
}

const sha256 = (v: string) => crypto.createHash('sha256').update(v, 'utf8').digest('hex')
const limpio = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()

/** Meta pide el email en minúsculas y sin espacios antes de hashear. */
export function hashEmail(v: string | null | undefined): string | null {
  const e = limpio(v)
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? sha256(e) : null
}

/** Solo dígitos, con prefijo de país y sin «+» ni ceros iniciales de marcación internacional. */
export function hashTelefono(v: string | null | undefined): string | null {
  let d = (v ?? '').replace(/[^\d+]/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  d = d.replace(/\D/g, '')
  return d.length >= 8 ? sha256(d) : null
}

export function hashTexto(v: string | null | undefined): string | null {
  const t = limpio(v)
  return t ? sha256(t) : null
}

/** `_fbc` a partir de un fbclid: `fb.1.<ms>.<fbclid>` (el valor del clic, NO se hashea). */
export function fbcDesdeFbclid(fbclid: string | null | undefined, clicMs: number): string | null {
  const id = (fbclid ?? '').trim()
  return id ? `fb.1.${Math.trunc(clicMs)}.${id}` : null
}

/** event_id determinista: el mismo lead/venta produce siempre el mismo id y Meta no lo cuenta dos veces. */
export function eventIdDeterminista(tipo: string, idInterno: string): string {
  return `${tipo}_${idInterno}`
}

const quitarNulos = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== ''))

export function construirEventoCapi(e: EventoCapiEntrada): Record<string, unknown> {
  const c = e.contacto
  const userData = quitarNulos({
    em: hashEmail(c.email) ? [hashEmail(c.email)] : null,
    ph: hashTelefono(c.phone) ? [hashTelefono(c.phone)] : null,
    fn: hashTexto(c.firstName) ? [hashTexto(c.firstName)] : null,
    ln: hashTexto(c.lastName) ? [hashTexto(c.lastName)] : null,
    country: hashTexto(c.country) ? [hashTexto(c.country)] : null,
    external_id: c.externalId ? [sha256(c.externalId.trim())] : null,
    fbc: e.fbc ?? null,
    fbp: e.fbp ?? null,
    client_ip_address: e.clientIp ?? null,
    client_user_agent: e.userAgent ?? null,
  })
  const evento: Record<string, unknown> = {
    event_name: e.eventName,
    event_time: Math.floor(e.eventTime.getTime() / 1000),
    event_id: e.eventId,
    action_source: 'website',
    user_data: userData,
  }
  if (e.url) evento.event_source_url = e.url
  if (e.value != null && e.currency) evento.custom_data = { value: e.value, currency: e.currency.toUpperCase() }
  return evento
}

export type ConfigCapi = { pixelId: string; accessToken: string; apiVersion: string }

/**
 * null = CAPI apagada. Exige Pixel ID numérico, token y la activación explícita: tener el token de
 * Ads en la integración NO basta para empezar a mandar datos a Meta.
 */
export function capiConfig(cfg: Record<string, string | undefined>): ConfigCapi | null {
  const pixelId = (cfg.META_PIXEL_ID ?? '').trim()
  const accessToken = (cfg.META_ACCESS_TOKEN ?? '').trim()
  if (cfg.META_CAPI_ENABLED !== 'true') return null
  if (!/^\d{8,20}$/.test(pixelId) || !accessToken) return null
  return { pixelId, accessToken, apiVersion: (cfg.META_API_VERSION ?? '').trim() || META_API_VERSION }
}

export type ResultadoEnvioCapi =
  | { ok: true; eventosRecibidos: number; fbtraceId: string | null }
  | { ok: false; error: string; fbtraceId: string | null }

export async function enviarEventosCapi(
  cfg: Pick<ConfigCapi, 'pixelId' | 'accessToken' | 'apiVersion'>,
  eventos: Record<string, unknown>[],
  opciones: { testEventCode?: string } = {}
): Promise<ResultadoEnvioCapi> {
  try {
    const res = await fetch(graphUrl(cfg.apiVersion, `${cfg.pixelId}/events`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // El token va en el cuerpo, no en la URL, para que no acabe en logs de acceso.
      body: JSON.stringify({
        data: eventos,
        access_token: cfg.accessToken,
        ...(opciones.testEventCode ? { test_event_code: opciones.testEventCode } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const json = (await res.json().catch(() => ({}))) as {
      events_received?: number
      fbtrace_id?: string
      error?: { message?: string }
    }
    if (!res.ok) {
      return {
        ok: false,
        error: json.error?.message ?? `Meta respondió ${res.status}`,
        fbtraceId: json.fbtrace_id ?? null,
      }
    }
    return { ok: true, eventosRecibidos: json.events_received ?? 0, fbtraceId: json.fbtrace_id ?? null }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo contactar con Meta', fbtraceId: null }
  }
}
