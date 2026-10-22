import type { SupabaseClient } from '@supabase/supabase-js'
import type { MensajeNormalizado } from './ingesta'

// ECO DE LO QUE ENVÍA LA IA. GHL devuelve por webhook, como mensaje SALIENTE, el DM que acaba de enviar el
// agente. Si se guardara como mensaje de una persona, la conversación pasaría a «abierta» y la IA se callaría
// a sí misma. Antes de cada envío el orquestador anota un evento `ia_intento` con el texto; aquí se reconoce
// el eco por (misma conversación, mismo texto, últimos minutos). Patrón de Chatwoot: desduplicar ecos.

export const VENTANA_ECO_MS = 5 * 60_000

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/** PURO: ¿este saliente coincide con algún intento reciente de la IA? */
export function coincideConIntento(
  m: Pick<MensajeNormalizado, 'direccion' | 'texto' | 'enviadoEn'>,
  intentos: readonly { texto: string; creadoEn: string }[],
  ahora: Date = new Date()
): boolean {
  if (m.direccion !== 'saliente') return false
  const t = Date.parse(m.enviadoEn)
  return intentos.some((i) => {
    const c = Date.parse(i.creadoEn)
    return (
      norm(i.texto) === norm(m.texto) &&
      Number.isFinite(c) &&
      ahora.getTime() - c <= VENTANA_ECO_MS &&
      (!Number.isFinite(t) || Math.abs(t - c) <= VENTANA_ECO_MS)
    )
  })
}

/** Marca como `ia` el mensaje saliente que sea el eco de un envío del agente. */
export async function marcarEcoDeIA(
  sb: SupabaseClient,
  tenantId: string,
  m: MensajeNormalizado,
  ahora: Date = new Date()
): Promise<MensajeNormalizado> {
  if (m.direccion !== 'saliente' || m.autor === 'ia') return m
  const { data: conv } = await sb
    .from('conversations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('source', 'ghl')
    .eq('external_id', m.conversationExternalId)
    .maybeSingle()
  const id = (conv as { id: string } | null)?.id
  if (!id) return m
  const desde = new Date(ahora.getTime() - VENTANA_ECO_MS).toISOString()
  const { data } = await sb
    .from('conversation_events')
    .select('data,created_at')
    .eq('tenant_id', tenantId)
    .eq('conversation_id', id)
    .eq('kind', 'ia_intento')
    .gte('created_at', desde)
    .limit(10)
  const intentos = ((data ?? []) as { data: { texto?: string }; created_at: string }[]).map((e) => ({
    texto: e.data?.texto ?? '',
    creadoEn: e.created_at,
  }))
  return coincideConIntento(m, intentos, ahora) ? { ...m, autor: 'ia' } : m
}
