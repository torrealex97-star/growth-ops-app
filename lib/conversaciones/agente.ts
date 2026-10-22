// AGENTE DE IA DE SETTING — DECISIÓN (pura, sin red ni base de datos).
//
// Esta capa responde a UNA pregunta antes de que se gaste una sola llamada a la IA ni se envíe nada:
// «¿puede el agente actuar en esta conversación ahora, y si no, por qué?». La IA solo REDACTA; lo que
// decide si se envía es este módulo, en código, con reglas fijas que ningún prompt puede saltarse.
//
// Principios (docs/plan, Chatwoot MIT, CLAUDE.md «Dinero»):
//   · APAGADO por defecto. Nada actúa sin un interruptor explícito de la subcuenta Y de la conversación.
//   · Solo canales de mensajería directa donde la API lo permite y SOLO dentro de la ventana de la IA.
//   · Si una persona ha escrito, la IA se calla (nunca compiten dos voces).
//   · Topes: mensajes seguidos sin respuesta del lead y envíos por día.
//   · El TRASPASO a humano es pronto y se decide por señales, no por el modelo.
//   · El agente nunca promete precio, descuento ni condiciones, y nunca toca ventas ni cobros.

import { canalAutorizadoParaIA, estadoVentana } from './ventana'
import type { Estado } from './estados'

export type ModoIA = 'off' | 'borrador' | 'autonomo'

export type ConfigAgente = {
  /** Interruptor general de la subcuenta. Por defecto false. */
  activo: boolean
  /** Si es false, aunque la conversación esté en autónomo se queda en borrador. */
  permitirAutonomo: boolean
  maxSeguidosSinRespuesta: number
  maxEnviosDia: number
  /** Horario de atención del agente en hora local de la subcuenta (`desde`/`hasta` en horas 0-24). null = siempre. */
  horario: { desde: number; hasta: number; zona: string } | null
  /** Reparte round-robin entre los setters las conversaciones sin responsable. Apagado por defecto. */
  repartoAutomatico: boolean
}

export const CONFIG_POR_DEFECTO: ConfigAgente = {
  activo: false,
  permitirAutonomo: false,
  maxSeguidosSinRespuesta: 2,
  maxEnviosDia: 200,
  horario: null,
  repartoAutomatico: false,
}

export type MensajeHistorial = { autor: 'lead' | 'humano' | 'ia' | 'sistema'; texto: string; enviadoEn: string }

export type ContextoConversacion = {
  canal: string
  estado: Estado
  aiMode: ModoIA
  ultimoEntrante: string | null
  historial: readonly MensajeHistorial[]
  /** Envíos del agente hoy en TODA la subcuenta. */
  enviosHoyDelAgente: number
}

export type MotivoSilencio =
  | 'agente_apagado'
  | 'conversacion_apagada'
  | 'canal_no_autorizado'
  | 'conversacion_resuelta'
  | 'ventana_cerrada'
  | 'humano_atiende'
  | 'tope_seguidos'
  | 'tope_diario'
  | 'fuera_de_horario'
  | 'sin_mensaje_del_lead'

export type DecisionAgente =
  | { actua: false; motivo: MotivoSilencio; detalle: string }
  | { actua: true; modo: 'borrador' | 'autonomo'; detalle: string }

const DETALLE: Record<MotivoSilencio, string> = {
  agente_apagado: 'El agente de IA está apagado en esta subcuenta.',
  conversacion_apagada: 'La IA está apagada en esta conversación.',
  canal_no_autorizado: 'La IA no actúa en este canal.',
  conversacion_resuelta: 'La conversación está resuelta.',
  ventana_cerrada: 'La ventana de respuesta de la IA está cerrada.',
  humano_atiende: 'Una persona ha respondido: la IA se calla.',
  tope_seguidos: 'Demasiados mensajes seguidos sin respuesta del lead.',
  tope_diario: 'Se alcanzó el tope diario de envíos del agente.',
  fuera_de_horario: 'Fuera del horario de atención del agente.',
  sin_mensaje_del_lead: 'El lead no ha escrito: no se escribe en frío.',
}
const no = (motivo: MotivoSilencio): DecisionAgente => ({ actua: false, motivo, detalle: DETALLE[motivo] })

/** Hora local (0-24, con decimales) de `ahora` en la zona dada. */
export function horaLocal(ahora: Date, zona: string): number {
  try {
    const partes = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: zona,
    }).formatToParts(ahora)
    const h = Number(partes.find((p) => p.type === 'hour')?.value ?? NaN)
    const m = Number(partes.find((p) => p.type === 'minute')?.value ?? NaN)
    return Number.isFinite(h) && Number.isFinite(m) ? (h % 24) + m / 60 : NaN
  } catch {
    return NaN
  }
}

export function dentroDeHorario(h: ConfigAgente['horario'], ahora: Date): boolean {
  if (!h) return true
  const hora = horaLocal(ahora, h.zona)
  // Un horario ilegible NO abre el agente: ante la duda, se calla.
  if (!Number.isFinite(hora)) return false
  return h.desde <= h.hasta ? hora >= h.desde && hora < h.hasta : hora >= h.desde || hora < h.hasta
}

/** Mensajes consecutivos del agente al final del historial, sin respuesta del lead entre medias. */
export function seguidosSinRespuesta(historial: readonly MensajeHistorial[]): number {
  let n = 0
  for (let i = historial.length - 1; i >= 0; i--) {
    const a = historial[i].autor
    if (a === 'lead') break
    if (a === 'ia') n++
  }
  return n
}

/** ¿Hay un mensaje de una PERSONA posterior al último del lead? Entonces la IA no responde. */
export function humanoRespondioDespues(historial: readonly MensajeHistorial[]): boolean {
  for (let i = historial.length - 1; i >= 0; i--) {
    if (historial[i].autor === 'lead') return false
    if (historial[i].autor === 'humano') return true
  }
  return false
}

export function decidirAgente(cfg: ConfigAgente, ctx: ContextoConversacion, ahora: Date = new Date()): DecisionAgente {
  if (!cfg.activo) return no('agente_apagado')
  if (ctx.aiMode === 'off') return no('conversacion_apagada')
  if (!canalAutorizadoParaIA(ctx.canal)) return no('canal_no_autorizado')
  if (ctx.estado === 'resuelta') return no('conversacion_resuelta')
  if (!ctx.ultimoEntrante) return no('sin_mensaje_del_lead')
  if (!estadoVentana(ctx.canal, 'ia', ctx.ultimoEntrante, ahora).abierta) return no('ventana_cerrada')
  if (humanoRespondioDespues(ctx.historial)) return no('humano_atiende')
  if (seguidosSinRespuesta(ctx.historial) >= cfg.maxSeguidosSinRespuesta) return no('tope_seguidos')
  if (ctx.enviosHoyDelAgente >= cfg.maxEnviosDia) return no('tope_diario')
  if (!dentroDeHorario(cfg.horario, ahora)) return no('fuera_de_horario')
  // Autónomo solo si la subcuenta lo permite Y la conversación lo pide; en cualquier otro caso, borrador.
  const modo = ctx.aiMode === 'autonomo' && cfg.permitirAutonomo ? 'autonomo' : 'borrador'
  return {
    actua: true,
    modo,
    detalle: modo === 'autonomo' ? 'Responde la IA dentro de la ventana.' : 'La IA propone un borrador para aprobar.',
  }
}
