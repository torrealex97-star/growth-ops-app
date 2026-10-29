import type { SupabaseClient } from '@supabase/supabase-js'
import { asignarRoundRobin } from './asignar'
import { decidirAgente, type MensajeHistorial } from './agente'
import { CLAVE_CONFIG_AGENTE, leerConfigAgente } from './config'
import { esEstado } from './estados'
import { memoriaParaPrompt } from './memoria-bd'
import { registrarMensaje } from './persistir'
import { construirPrompt, validarBorrador } from './redactor'
import { evaluarTraspaso, exigeNoContactar, type MotivoTraspaso } from './traspaso'

// ORQUESTADOR DEL AGENTE DE SETTING: lo que ocurre DESPUÉS de guardar un mensaje entrante.
//
// Orden fijo, de lo más barato y seguro a lo más caro: (1) ¿puede actuar? (2) ¿ya se procesó este mensaje?
// (3) ¿hay señales de traspaso? (4) redactar con la IA (5) validar (6) borrador o envío. La IA solo se llama en
// el paso 4, y solo si los anteriores lo permiten. Todo efecto deja una fila en `conversation_events`.
//
// Las dependencias externas (IA y envío) se inyectan: así se prueba el flujo entero sin red.

export type DepsOrquestador = {
  ia: (req: {
    system: string
    messages: { role: 'user' | 'assistant'; content: string }[]
    maxTokens: number
    temperature?: number
  }) => Promise<{ text: string; engine?: string; model?: string }>
  enviar: (p: {
    conversationExternalId: string
    contactExternalId: string
    canal: string
    texto: string
  }) => Promise<{ messageId: string | null }>
  ahora?: () => Date
}

export type ResultadoOrquestador =
  | { accion: 'silencio'; motivo: string }
  | { accion: 'ya_procesado' }
  | { accion: 'traspaso'; motivo: string }
  | { accion: 'borrador'; texto: string }
  | { accion: 'enviado'; texto: string }
  | { accion: 'error'; error: string }

type FilaConv = {
  id: string
  external_id: string
  channel: string
  status: string
  ai_mode: string
  contact_id: string | null
  contact_external_id: string | null
  last_inbound_at: string | null
  labels: string[]
  assignee_id: string | null
}

const evento = async (
  sb: SupabaseClient,
  tenantId: string,
  conversationId: string,
  kind: string,
  data: Record<string, unknown>
) => {
  const { error } = await sb
    .from('conversation_events')
    .insert({ tenant_id: tenantId, conversation_id: conversationId, kind, data })
  // La acción principal ya se ejecutó; un 500 aquí provocaría reintentos del remitente y duplicaría
  // el efecto. La pérdida se hace visible a log, que es lo único honesto que queda.
  if (error) console.error(`[conversaciones] no se pudo registrar el evento '${kind}':`, error.message)
}

async function traspasar(
  sb: SupabaseClient,
  tenantId: string,
  c: FilaConv,
  motivo: string,
  mensajeId: string,
  noContactar = false,
  repartir = false
) {
  const etiquetas = noContactar && !c.labels.includes('no-contactar') ? [...c.labels, 'no-contactar'] : c.labels
  await sb
    .from('conversations')
    .update({ status: 'abierta', ai_mode: 'off', labels: etiquetas, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', c.id)
  await evento(sb, tenantId, c.id, 'traspaso', { motivo, mensaje_id: mensajeId, no_contactar: noContactar })
  // Quien recibe el traspaso es una persona: si nadie es responsable aún, el reparto se lo da a un setter.
  if (repartir && !c.assignee_id) await asignarRoundRobin(sb, tenantId, c.id)
}

export async function procesarMensajeEntrante(
  sb: SupabaseClient,
  tenantId: string,
  conversationId: string,
  mensajeEntranteId: string,
  deps: DepsOrquestador
): Promise<ResultadoOrquestador> {
  const ahora = deps.ahora?.() ?? new Date()

  const { data: fila, error } = await sb
    .from('conversations')
    .select('id,external_id,channel,status,ai_mode,contact_id,contact_external_id,last_inbound_at,labels,assignee_id')
    .eq('tenant_id', tenantId)
    .eq('id', conversationId)
    .maybeSingle()
  if (error || !fila) return { accion: 'error', error: 'conversación no encontrada' }
  const c = fila as FilaConv

  const { data: ajuste } = await sb
    .from('integration_settings')
    .select('value')
    .eq('tenant_id', tenantId)
    .eq('key', CLAVE_CONFIG_AGENTE)
    .maybeSingle()
  const { config, guion } = leerConfigAgente((ajuste as { value?: string } | null)?.value ?? null)
  const repartir = config.repartoAutomatico

  // Barato primero: IA apagada en la conversación → la atiende una persona; solo se le busca responsable.
  if (c.ai_mode === 'off') {
    // Solo si nadie es responsable: así los mensajes siguientes de una conversación ya asignada no repiten 5 consultas.
    if (repartir && !c.assignee_id) await asignarRoundRobin(sb, tenantId, c.id)
    return { accion: 'silencio', motivo: 'conversacion_apagada' }
  }
  if (!config.activo) return { accion: 'silencio', motivo: 'agente_apagado' }

  const { data: filasMsg } = await sb
    .from('conversation_messages')
    .select('external_id,author,body,sent_at')
    .eq('tenant_id', tenantId)
    .eq('conversation_id', c.id)
    .order('sent_at', { ascending: false })
    .limit(30)
  const mensajes = (
    (filasMsg ?? []) as { external_id: string; author: MensajeHistorial['autor']; body: string; sent_at: string }[]
  ).reverse()
  const historial: MensajeHistorial[] = mensajes.map((m) => ({ autor: m.author, texto: m.body, enviadoEn: m.sent_at }))

  const inicioDia = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate())).toISOString()
  // Tope diario de INTERACCIONES del agente (cada mensaje procesado que llega a la IA, sea borrador o envío): contar
  // solo `ia_envio` dejaba sin tope el modo borrador, donde cada DM de un lead provocaba una llamada al modelo.
  const { count: enviosHoy } = await sb
    .from('conversation_events')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .eq('kind', 'agente')
    .gte('created_at', inicioDia)

  const decision = decidirAgente(
    config,
    {
      canal: c.channel,
      estado: esEstado(c.status) ? c.status : 'abierta',
      aiMode: c.ai_mode === 'autonomo' ? 'autonomo' : c.ai_mode === 'borrador' ? 'borrador' : 'off',
      ultimoEntrante: c.last_inbound_at,
      historial,
      enviosHoyDelAgente: enviosHoy ?? 0,
    },
    ahora
  )
  if (!decision.actua) return { accion: 'silencio', motivo: decision.motivo }

  // Idempotencia: un mensaje se procesa UNA vez (el webhook se reintenta y la sincronización lo repite).
  const { data: previo } = await sb
    .from('conversation_events')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('conversation_id', c.id)
    .eq('kind', 'agente')
    .eq('data->>mensaje_id', mensajeEntranteId)
    .limit(1)
    .maybeSingle()
  if (previo) return { accion: 'ya_procesado' }
  await evento(sb, tenantId, c.id, 'agente', { mensaje_id: mensajeEntranteId, modo: decision.modo })

  const ultimoLead = [...historial].reverse().find((m) => m.autor === 'lead')
  const traspaso = evaluarTraspaso(ultimoLead?.texto ?? '')
  if (traspaso.traspasar) {
    await traspasar(
      sb,
      tenantId,
      c,
      traspaso.motivo as MotivoTraspaso,
      mensajeEntranteId,
      exigeNoContactar(traspaso.motivo),
      repartir
    )
    return { accion: 'traspaso', motivo: traspaso.motivo ?? 'señal' }
  }

  // Datos que ya se conocen del lead: no se vuelven a preguntar.
  const conocidos = new Set<string>()
  if (c.contact_id) {
    const { data: contacto } = await sb
      .from('contacts')
      .select('qualification')
      .eq('tenant_id', tenantId)
      .eq('id', c.contact_id)
      .maybeSingle()
    const q = (contacto as { qualification?: Record<string, unknown> } | null)?.qualification
    for (const [k, v] of Object.entries(q ?? {})) if (k !== 'respuestas' && v !== null && v !== '') conocidos.add(k)
  }

  // Memoria: lo hablado fuera de la ventana del prompt y lo de otras conversaciones de la misma persona.
  const memoria = await memoriaParaPrompt(sb, tenantId, c, deps.ia)

  let texto: string
  try {
    const prompt = construirPrompt(
      guion,
      conocidos,
      historial.map((m) => ({ autor: m.autor === 'sistema' ? 'humano' : m.autor, texto: m.texto })),
      memoria
    )
    const r = await deps.ia({ system: prompt.system, messages: prompt.messages, maxTokens: 300, temperature: 0.4 })
    const v = validarBorrador(r.text, guion.enlaceAgenda)
    if (!v.ok) {
      await traspasar(sb, tenantId, c, `validacion: ${v.motivo}`, mensajeEntranteId, false, repartir)
      return { accion: 'traspaso', motivo: `validacion: ${v.motivo}` }
    }
    texto = v.texto
  } catch (e) {
    // La IA no respondió: no se queda el lead sin atender. Pasa a una persona y se anota el motivo.
    const msg = e instanceof Error ? e.message : 'error de la IA'
    await traspasar(sb, tenantId, c, `ia_error: ${msg}`.slice(0, 200), mensajeEntranteId, false, repartir)
    return { accion: 'error', error: msg }
  }

  if (decision.modo === 'borrador') {
    await evento(sb, tenantId, c.id, 'borrador', { texto, mensaje_id: mensajeEntranteId, estado: 'pendiente' })
    return { accion: 'borrador', texto }
  }

  // Autónomo: se envía y se guarda como mensaje de la IA. Un fallo de envío traspasa; nunca reintenta a ciegas.
  if (!c.contact_external_id) {
    await traspasar(sb, tenantId, c, 'sin_contacto_ghl', mensajeEntranteId, false, repartir)
    return { accion: 'traspaso', motivo: 'sin_contacto_ghl' }
  }
  try {
    // Se anota ANTES de enviar: el eco que devuelve GHL se reconoce por este texto (lib/conversaciones/eco.ts).
    await evento(sb, tenantId, c.id, 'ia_intento', { texto, mensaje_id: mensajeEntranteId })
    const { messageId } = await deps.enviar({
      conversationExternalId: c.external_id,
      contactExternalId: c.contact_external_id,
      canal: c.channel,
      texto,
    })
    await registrarMensaje(sb, tenantId, {
      externalId: messageId ?? `ia-${mensajeEntranteId}`,
      conversationExternalId: c.external_id,
      contactExternalId: c.contact_external_id,
      canal: c.channel,
      direccion: 'saliente',
      autor: 'ia',
      texto,
      enviadoEn: ahora.toISOString(),
    })
    await evento(sb, tenantId, c.id, 'ia_envio', { mensaje_id: mensajeEntranteId, respuesta_id: messageId })
    return { accion: 'enviado', texto }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error de envío'
    await traspasar(sb, tenantId, c, `envio_error: ${msg}`.slice(0, 200), mensajeEntranteId, false, repartir)
    return { accion: 'error', error: msg }
  }
}
