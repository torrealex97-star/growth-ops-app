// INGESTA DE MENSAJES (pura): convierte lo que manda GHL (webhook o sincronización) en filas listas para guardar.
// Idempotente por `external_id`: el mismo mensaje por webhook y por sincronización es UNA fila. Patrones de
// Chatwoot (MIT): responder 200 enseguida, y los ECOS de nuestros propios envíos no se tratan como mensajes del lead.

export type AutorMensaje = 'lead' | 'humano' | 'ia' | 'sistema'

export type MensajeNormalizado = {
  externalId: string
  conversationExternalId: string
  contactExternalId: string | null
  canal: string
  direccion: 'entrante' | 'saliente'
  autor: AutorMensaje
  texto: string
  enviadoEn: string
}

type Json = Record<string, unknown>
const esObjeto = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const txt = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

function canalDe(tipo: string): string {
  const t = tipo.replace(/^TYPE_/, '').toLowerCase()
  if (t === 'ig' || t === 'instagram') return 'instagram'
  if (t === 'fb' || t === 'facebook') return 'facebook'
  return t || 'chat'
}

function fechaIso(v: unknown): string | null {
  const t = typeof v === 'number' ? v : Date.parse(txt(v))
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/**
 * Webhook `InboundMessage` / `OutboundMessage` de GHL. Devuelve `null` si no es un mensaje que se pueda guardar
 * (sin id, sin conversación o sin fecha): no se inventa nada. `idsEnviadosPorLaApp` son los ids que la propia app
 * envió (agente de IA o composer): su eco se marca como `ia` / `humano` y no como entrante.
 */
export function normalizarMensajeGhl(
  payload: unknown,
  idsEnviadosPorLaApp: ReadonlyMap<string, 'ia' | 'humano'> = new Map()
): MensajeNormalizado | null {
  if (!esObjeto(payload)) return null
  const externalId = txt(payload.messageId) || txt(payload.id)
  const conversationExternalId = txt(payload.conversationId)
  const enviadoEn = fechaIso(payload.dateAdded) ?? fechaIso(payload.timestamp)
  if (!externalId || !conversationExternalId || !enviadoEn) return null

  const direccion = txt(payload.direction).toLowerCase() === 'inbound' ? 'entrante' : 'saliente'
  const propio = idsEnviadosPorLaApp.get(externalId)
  const autor: AutorMensaje = direccion === 'entrante' ? 'lead' : (propio ?? 'humano')
  const cuerpo = txt(payload.body)
  return {
    externalId,
    conversationExternalId,
    contactExternalId: txt(payload.contactId) || null,
    canal: canalDe(txt(payload.messageType) || txt(payload.type)),
    direccion,
    autor,
    texto: cuerpo || `(${txt(payload.messageType) || 'mensaje'} sin texto)`,
    enviadoEn,
  }
}

/** Mensajes ya guardados que no hay que volver a insertar (el eco por webhook de lo que ya trajo la sincronización). */
export function sinDuplicados<T extends { externalId: string }>(
  nuevos: readonly T[],
  yaGuardados: ReadonlySet<string>
): T[] {
  const vistos = new Set<string>()
  const salida: T[] = []
  for (const m of nuevos) {
    if (yaGuardados.has(m.externalId) || vistos.has(m.externalId)) continue
    vistos.add(m.externalId)
    salida.push(m)
  }
  return salida
}

/** Último mensaje ENTRANTE de una lista: de él depende la ventana de respuesta. */
export function ultimoEntrante(mensajes: readonly MensajeNormalizado[]): string | null {
  let mejor: string | null = null
  for (const m of mensajes) if (m.direccion === 'entrante' && (!mejor || m.enviadoEn > mejor)) mejor = m.enviadoEn
  return mejor
}
