import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarMensaje } from './persistir'
import { estadoVentana } from './ventana'

// ENVÍO DE UNA PERSONA (responder o aprobar un borrador). Las dos acciones pasan por aquí para que las reglas
// sean idénticas: ventana abierta, contacto de GHL, texto acotado, mensaje guardado como del EQUIPO y una fila
// de auditoría con quién lo envió.
//
// VENTANA: una persona podría usar la etiqueta HUMAN_AGENT (7 días) en Meta, pero GHL no documenta que la
// aplique al enviar por «IG». Hasta comprobarlo con una cuenta real se usa la ventana de 24 h para todos:
// es la única que está garantizada.

export const MAX_TEXTO = 1000

export type DepsEnvio = {
  enviar: (p: {
    conversationExternalId: string
    contactExternalId: string
    canal: string
    texto: string
  }) => Promise<{ messageId: string | null }>
  ahora?: () => Date
}

export type ResultadoEnvio =
  { ok: true; messageId: string | null } | { ok: false; status: 400 | 404 | 409 | 502; error: string }

type FilaConv = {
  id: string
  external_id: string
  channel: string
  status: string
  contact_external_id: string | null
  last_inbound_at: string | null
}

export async function enviarComoPersona(
  sb: SupabaseClient,
  tenantId: string,
  conversationId: string,
  textoEntrada: string,
  usuarioId: string,
  deps: DepsEnvio,
  origen: { tipo: 'respuesta' } | { tipo: 'borrador'; eventoId: string }
): Promise<ResultadoEnvio> {
  const texto = (textoEntrada ?? '').trim()
  if (!texto) return { ok: false, status: 400, error: 'El mensaje está vacío' }
  if (texto.length > MAX_TEXTO) return { ok: false, status: 400, error: `El mensaje supera ${MAX_TEXTO} caracteres` }

  const { data: fila } = await sb
    .from('conversations')
    .select('id,external_id,channel,status,contact_external_id,last_inbound_at')
    .eq('tenant_id', tenantId)
    .eq('id', conversationId)
    .maybeSingle()
  if (!fila) return { ok: false, status: 404, error: 'Conversación no encontrada' }
  const c = fila as FilaConv
  if (!c.contact_external_id)
    return { ok: false, status: 400, error: 'Esta conversación no tiene contacto de GHL: no se puede responder' }

  const ahora = deps.ahora?.() ?? new Date()
  const v = estadoVentana(c.channel, 'ia', c.last_inbound_at, ahora)
  if (!v.abierta)
    return {
      ok: false,
      status: 409,
      error: `La ventana de respuesta está cerrada (${v.motivo}). Escribe desde GHL con la etiqueta adecuada.`,
    }

  // Para borradores: se reclama ANTES de enviar (un doble clic o dos pestañas no pueden enviarlo dos veces).
  if (origen.tipo === 'borrador') {
    const { data: ev } = await sb
      .from('conversation_events')
      .select('id,data')
      .eq('tenant_id', tenantId)
      .eq('conversation_id', conversationId)
      .eq('id', origen.eventoId)
      .eq('kind', 'borrador')
      .maybeSingle()
    const d = (ev as { data: Record<string, unknown> } | null)?.data
    if (!ev || !d) return { ok: false, status: 404, error: 'Borrador no encontrado' }
    if (d.estado !== 'pendiente') return { ok: false, status: 409, error: 'Este borrador ya se resolvió' }
    await sb
      .from('conversation_events')
      .update({ data: { ...d, estado: 'aprobado', por: usuarioId } })
      .eq('tenant_id', tenantId)
      .eq('id', origen.eventoId)
  }

  let messageId: string | null
  try {
    ;({ messageId } = await deps.enviar({
      conversationExternalId: c.external_id,
      contactExternalId: c.contact_external_id,
      canal: c.channel,
      texto,
    }))
  } catch (e) {
    // Si falla el envío de un borrador, vuelve a pendiente para poder reintentarlo.
    if (origen.tipo === 'borrador') {
      const { data: ev } = await sb
        .from('conversation_events')
        .select('data')
        .eq('tenant_id', tenantId)
        .eq('id', origen.eventoId)
        .maybeSingle()
      const d = (ev as { data: Record<string, unknown> } | null)?.data ?? {}
      await sb
        .from('conversation_events')
        .update({ data: { ...d, estado: 'pendiente' } })
        .eq('tenant_id', tenantId)
        .eq('id', origen.eventoId)
    }
    return { ok: false, status: 502, error: e instanceof Error ? e.message : 'No se pudo enviar el mensaje' }
  }

  await registrarMensaje(sb, tenantId, {
    externalId: messageId ?? `eq-${conversationId}-${ahora.getTime()}`,
    conversationExternalId: c.external_id,
    contactExternalId: c.contact_external_id,
    canal: c.channel,
    direccion: 'saliente',
    autor: 'humano',
    texto,
    enviadoEn: ahora.toISOString(),
  })
  await sb.from('conversation_events').insert({
    tenant_id: tenantId,
    conversation_id: conversationId,
    actor_user_id: usuarioId,
    kind: origen.tipo === 'borrador' ? 'borrador_aprobado' : 'respuesta',
    data: { respuesta_id: messageId, ...(origen.tipo === 'borrador' ? { evento_id: origen.eventoId } : {}) },
  })
  return { ok: true, messageId }
}

/** Descartar un borrador (idempotente: solo uno pendiente se descarta). */
export async function descartarBorrador(
  sb: SupabaseClient,
  tenantId: string,
  conversationId: string,
  eventoId: string,
  usuarioId: string
): Promise<ResultadoEnvio> {
  const { data: ev } = await sb
    .from('conversation_events')
    .select('id,data')
    .eq('tenant_id', tenantId)
    .eq('conversation_id', conversationId)
    .eq('id', eventoId)
    .eq('kind', 'borrador')
    .maybeSingle()
  const d = (ev as { data: Record<string, unknown> } | null)?.data
  if (!ev || !d) return { ok: false, status: 404, error: 'Borrador no encontrado' }
  if (d.estado !== 'pendiente') return { ok: false, status: 409, error: 'Este borrador ya se resolvió' }
  await sb
    .from('conversation_events')
    .update({ data: { ...d, estado: 'descartado', por: usuarioId } })
    .eq('tenant_id', tenantId)
    .eq('id', eventoId)
  return { ok: true, messageId: null }
}
