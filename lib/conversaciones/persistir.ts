import type { SupabaseClient } from '@supabase/supabase-js'
import { siguienteEstado, esEstado, type Estado } from './estados'
import type { MensajeNormalizado } from './ingesta'

// PERSISTENCIA DE UN MENSAJE: conversación + mensaje + auditoría, IDEMPOTENTE.
//
// El mismo mensaje llega por webhook y por la sincronización de respaldo; guardarlo dos veces duplicaría
// contadores y estados. Por eso el efecto sobre la conversación (no leídos, estado, último entrante) solo se
// aplica si el mensaje es NUEVO (el insert con `ignoreDuplicates` no devuelve fila si ya existía).

export type FilaConversacion = {
  id: string
  status: string
  snoozed_until: string | null
  last_inbound_at: string | null
  last_message_at: string | null
  first_reply_at: string | null
  unread_count: number
}

export type ParcheConversacion = {
  status: Estado
  snoozed_until: string | null
  last_inbound_at: string | null
  last_message_at: string
  first_reply_at: string | null
  unread_count: number
}

const max = (a: string | null, b: string) => (a && a > b ? a : b)

/** PURO: cómo cambia una conversación al entrar un mensaje NUEVO. */
export function parchePorMensaje(c: FilaConversacion, m: MensajeNormalizado): ParcheConversacion {
  const actual = { estado: esEstado(c.status) ? c.status : ('abierta' as Estado), aplazadaHasta: c.snoozed_until }
  const evento =
    m.autor === 'lead'
      ? ({ tipo: 'mensaje_entrante' } as const)
      : m.autor === 'ia'
        ? ({ tipo: 'respuesta_ia' } as const)
        : m.autor === 'humano'
          ? ({ tipo: 'respuesta_humana' } as const)
          : null
  const sig = evento ? siguienteEstado(actual, evento) : actual
  return {
    status: sig.estado,
    snoozed_until: sig.aplazadaHasta,
    last_inbound_at: m.direccion === 'entrante' ? max(c.last_inbound_at, m.enviadoEn) : c.last_inbound_at,
    last_message_at: max(c.last_message_at, m.enviadoEn),
    // «Primera respuesta» = primer mensaje SALIENTE de una persona o de la IA tras un entrante.
    first_reply_at:
      c.first_reply_at ??
      (m.direccion === 'saliente' && (m.autor === 'humano' || m.autor === 'ia') && c.last_inbound_at
        ? m.enviadoEn
        : null),
    unread_count: m.direccion === 'entrante' ? c.unread_count + 1 : 0,
  }
}

export type ResultadoRegistro = { ok: true; nuevo: boolean; conversationId: string } | { ok: false; error: string }

export async function registrarMensaje(
  sb: SupabaseClient,
  tenantId: string,
  m: MensajeNormalizado
): Promise<ResultadoRegistro> {
  // 1) Conversación (get-or-create por clave única).
  const { data: previa, error: errBusca } = await sb
    .from('conversations')
    .select('id,status,snoozed_until,last_inbound_at,last_message_at,first_reply_at,unread_count')
    .eq('tenant_id', tenantId)
    .eq('source', 'ghl')
    .eq('external_id', m.conversationExternalId)
    .maybeSingle()
  if (errBusca) return { ok: false, error: errBusca.message }

  let conv = previa as FilaConversacion | null
  if (!conv) {
    let contactId: string | null = null
    if (m.contactExternalId) {
      const { data: c } = await sb
        .from('contacts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('ghl_contact_id', m.contactExternalId)
        .is('merged_into', null)
        .limit(1)
        .maybeSingle()
      contactId = (c as { id: string } | null)?.id ?? null
    }
    // Una conversación nueva nace con IA apagada y pendiente de que una persona la vea.
    const { data: creada, error: errCrea } = await sb
      .from('conversations')
      .upsert(
        {
          tenant_id: tenantId,
          source: 'ghl',
          external_id: m.conversationExternalId,
          channel: m.canal,
          contact_id: contactId,
          contact_external_id: m.contactExternalId,
          status: 'abierta',
          ai_mode: 'off',
        },
        { onConflict: 'tenant_id,source,external_id', ignoreDuplicates: false }
      )
      .select('id,status,snoozed_until,last_inbound_at,last_message_at,first_reply_at,unread_count')
      .single()
    if (errCrea || !creada) return { ok: false, error: errCrea?.message ?? 'no se pudo crear la conversación' }
    conv = creada as FilaConversacion
  }

  // 2) Mensaje: idempotente. Si ya existía, no se toca nada más.
  const { data: insertado, error: errMsg } = await sb
    .from('conversation_messages')
    .upsert(
      {
        tenant_id: tenantId,
        conversation_id: conv.id,
        external_id: m.externalId,
        direction: m.direccion,
        author: m.autor,
        body: m.texto.slice(0, 5000),
        sent_at: m.enviadoEn,
      },
      { onConflict: 'tenant_id,external_id', ignoreDuplicates: true }
    )
    .select('id')
    .maybeSingle()
  if (errMsg) return { ok: false, error: errMsg.message }
  if (!insertado) return { ok: true, nuevo: false, conversationId: conv.id }

  // 3) Efecto sobre la conversación y auditoría (solo para mensajes nuevos).
  const estadoAnterior = conv.status
  const parche = parchePorMensaje(conv, m)
  const { error: errUp } = await sb
    .from('conversations')
    .update({ ...parche, channel: m.canal, updated_at: new Date().toISOString() })
    .eq('id', conv.id)
    .eq('tenant_id', tenantId)
  if (errUp) return { ok: false, error: errUp.message }
  if (parche.status !== estadoAnterior) {
    await sb.from('conversation_events').insert({
      tenant_id: tenantId,
      conversation_id: conv.id,
      kind: 'estado',
      data: { de: estadoAnterior, a: parche.status, por: m.autor },
    })
  }
  return { ok: true, nuevo: true, conversationId: conv.id }
}
