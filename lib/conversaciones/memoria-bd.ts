import type { SupabaseClient } from '@supabase/supabase-js'
import { construirPromptResumen, limpiarResumen, memoriaDelContacto, necesitaResumen } from './memoria'
import { MAX_TURNOS } from './redactor'

// Lee (y, si toca, actualiza) la memoria de una conversación. NUNCA rompe el flujo del agente: la memoria es una
// ayuda, así que cualquier fallo devuelve lo que haya (o nada) y se registra el aviso.

type Ia = (req: {
  system: string
  messages: { role: 'user' | 'assistant'; content: string }[]
  maxTokens: number
  temperature?: number
}) => Promise<{ text: string }>

type Msg = { author: 'lead' | 'humano' | 'ia' | 'sistema'; body: string; sent_at: string }

export async function memoriaParaPrompt(
  sb: SupabaseClient,
  tenantId: string,
  conv: { id: string; contact_id: string | null },
  ia: Ia
): Promise<string | null> {
  try {
    const { data: actual } = await sb
      .from('conversations')
      .select('summary')
      .eq('tenant_id', tenantId)
      .eq('id', conv.id)
      .maybeSingle()
    let propio = (actual as { summary: string | null } | null)?.summary ?? null

    // Solo se resume lo que ya no cabe en el prompt: si hay pocos mensajes, no se gasta ninguna llamada.
    const { count } = await sb
      .from('conversation_messages')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('conversation_id', conv.id)
    if ((count ?? 0) > MAX_TURNOS + 3) {
      const { data: filas } = await sb
        .from('conversation_messages')
        .select('author,body,sent_at')
        .eq('tenant_id', tenantId)
        .eq('conversation_id', conv.id)
        .order('sent_at', { ascending: false })
        .limit(MAX_TURNOS + 40)
      const orden = ((filas ?? []) as Msg[]).slice().reverse()
      const fuera = orden.slice(0, Math.max(0, orden.length - MAX_TURNOS))
      const { data: ult } = await sb
        .from('conversation_events')
        .select('data')
        .eq('tenant_id', tenantId)
        .eq('conversation_id', conv.id)
        .eq('kind', 'resumen')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      const hasta = ((ult as { data?: { hasta?: string } } | null)?.data?.hasta as string | undefined) ?? null
      const candidatos = fuera.map((m) => ({ ...m, enviadoEn: m.sent_at }))
      if (necesitaResumen(candidatos, hasta)) {
        const nuevos = candidatos
          .filter((m) => !hasta || m.enviadoEn > hasta)
          .map((m) => ({ autor: m.author === 'sistema' ? ('humano' as const) : m.author, texto: m.body }))
        const p = construirPromptResumen(propio, nuevos)
        const r = await ia({ system: p.system, messages: p.messages, maxTokens: 300, temperature: 0.2 })
        const limpio = limpiarResumen(r.text)
        if (limpio) {
          propio = limpio
          const { error: errResumen } = await sb
            .from('conversations')
            .update({ summary: limpio, updated_at: new Date().toISOString() })
            .eq('tenant_id', tenantId)
            .eq('id', conv.id)
          // Si el resumen no se persiste se pierde memoria de la conversación en silencio; se ve a log
          // y la siguiente ventana de resumen lo reconstruirá.
          if (errResumen) console.error('[conversaciones] no se pudo guardar el resumen:', errResumen.message)
          const { error: errEvento } = await sb.from('conversation_events').insert({
            tenant_id: tenantId,
            conversation_id: conv.id,
            kind: 'resumen',
            data: { hasta: fuera[fuera.length - 1].sent_at },
          })
          if (errEvento) console.error('[conversaciones] no se pudo registrar el evento resumen:', errEvento.message)
        }
      }
    }

    let otros: (string | null)[] = []
    if (conv.contact_id) {
      const { data } = await sb
        .from('conversations')
        .select('summary')
        .eq('tenant_id', tenantId)
        .eq('contact_id', conv.contact_id)
        .neq('id', conv.id)
        .not('summary', 'is', null)
        .order('last_message_at', { ascending: false })
        .limit(2)
      otros = ((data ?? []) as { summary: string | null }[]).map((f) => f.summary)
    }
    return memoriaDelContacto(propio, otros)
  } catch (e) {
    console.warn('[conversaciones] memoria no disponible:', e instanceof Error ? e.message : e)
    return null
  }
}
