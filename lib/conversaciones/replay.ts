// REPLAY TEMPORAL DE UNA CONVERSACIÓN (puro): la parte estilo OpenReplay que se puede probar sin BD ni UI.
//
// La bitácora (`conversation_events`) ya guarda cada cambio (estados, asignaciones, traspasos, borradores,
// envíos y notas), y `conversation_messages` guarda cada mensaje con su `sent_at`. Unirlos por instante da la
// línea de tiempo de la conversación: qué pasó, en orden, sin volver a reconstruirlo en el cliente.
//
// «Un hueco no es un cero»: un evento sin instante utilizable (created_at vacío o no parseable) se excluye
// de la línea, no se inventa una hora.

import type { Estado } from './estados'

export type MensajeReplay = {
  direction: string
  author: string
  body: string
  sent_at: string
}
export type EventoReplay = { id: string; kind: string; data: Record<string, unknown> | null; created_at: string }
export type NotaReplay = { id: string; texto: string; creadoEn: string }

export type PasoReplay = {
  tipo: 'mensaje' | 'evento' | 'nota'
  author?: string
  direction?: string
  body?: string
  kind?: string
  texto?: string
  /** Instante ISO del paso (siempre presente: sin él el paso no entra). */
  t: string
}

const DH = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null)

/** Texto humano (español, neutro) de un evento de bitácora. Nunca ilumina ids humanos: («Alguien del equipo»). */
export function etiquetaEvento(kind: string, data: Record<string, unknown> | null): string {
  const d = data ?? {}
  const notaFijada = d.fijar === true || d.a === true
  switch (kind) {
    case 'estado':
      return `Estado: ${d.de ?? '—'} → ${d.a ?? '—'}`
    case 'asignacion':
      return d.auto === true ? 'Asignación automática a un setter' : 'Asignación a una persona'
    case 'etiquetas':
      return Array.isArray(d.a) && d.a.length > 0 ? `Etiquetas: ${d.a.join(', ')}` : 'Etiquetas quitadas'
    case 'modo_ia': {
      const modo = d.a === 'off' ? 'apagado' : d.a === 'borrador' ? 'borrador' : d.a === 'autonomo' ? 'autónomo' : d.a
      return `Modo de la IA: ${modo}`
    }
    case 'traspaso':
      return typeof d.motivo === 'string' && d.motivo
        ? `Traspaso a humano: ${d.motivo.split(':')[0]}`
        : 'Traspaso a humano'
    case 'borrador': {
      if (d.estado === 'pendiente') return 'Borrador del agente pendiente de revisar'
      if (d.estado === 'aprobado') return 'Borrador aprobado y enviado'
      return 'Borrador descartado'
    }
    case 'ia_envio':
      return 'Envío del agente de IA'
    case 'resumen':
      return 'Resumen de memoria actualizado'
    case 'nota':
      return 'Nota privada del equipo'
    case 'nota_fijar':
      return notaFijada ? 'Nota privada fijada' : 'Nota privada desfijada'
    case 'mensaje_entrante':
    case 'respuesta_humana':
    case 'respuesta_ia':
    case 'traspaso_a_humano':
    case 'asignar_a_ia':
    case 'aplazar':
    case 'resolver':
    case 'reabrir':
      return `Estado: ${kind}`
    default:
      return kind
  }
}

/**
 * Línea de tiempo del hilo: mensajes (por `sent_at`), eventos de bitácora (por `created_at`) y notas privadas,
 * ordenados de más antiguo a más reciente. Las entradas sin instante utilizable se excluyen: se muestran las
 * que se pueden reproducir, nunca una hora inventada.
 */
export function lineaReplay(
  mensajes: readonly MensajeReplay[],
  eventos: readonly EventoReplay[],
  notas: readonly NotaReplay[]
): PasoReplay[] {
  const pasos: (PasoReplay & { _orden: number })[] = []
  mensajes.forEach((m, i) => {
    const t = DH(m.sent_at)
    if (t) pasos.push({ tipo: 'mensaje', author: m.author, direction: m.direction, body: m.body, t, _orden: i })
  })
  eventos.forEach((e, i) => {
    const t = DH(e.created_at)
    if (t) pasos.push({ tipo: 'evento', kind: e.kind, texto: etiquetaEvento(e.kind, e.data), t, _orden: i })
    void e.id
  })
  notas.forEach((n, i) => {
    const t = DH(n.creadoEn)
    if (t) pasos.push({ tipo: 'nota', texto: n.texto, t, _orden: i })
  })
  return pasos
    .sort((a, b) => (a.t !== b.t ? (a.t < b.t ? -1 : 1) : a._orden - b._orden))
    .map(({ _orden, ...paso }) => paso)
}

export type ProgramaReplay = {
  pasos: PasoReplay[]
  /** Instante del primer paso (ISO) o null sin línea. */
  inicio: string | null
  /** Duración total, en ms, desde `inicio` hasta el último paso. 0 con un solo paso. */
  duracionMs: number
}

/** Programa de reproducción a partir de la línea: qué rango de tiempo cubre el replay. */
export function programaReplay(pasos: readonly PasoReplay[]): ProgramaReplay {
  const inicio = pasos[0]?.t ?? null
  const fin = pasos[pasos.length - 1]?.t ?? null
  const duracionMs = inicio && fin && inicio !== fin ? Math.max(0, Date.parse(fin) - Date.parse(inicio)) : 0
  return { pasos: [...pasos], inicio, duracionMs }
}

/** Índice del ÚLTIMO paso visible cuando el reloj va por `offsetMs` desde el inicio (−1: ninguno). */
export function indiceEnReplay(pasos: readonly PasoReplay[], offsetMs: number): number {
  if (!pasos.length) return -1
  const t0 = pasos[0].t
  let idx = -1
  for (let i = 0; i < pasos.length; i++) {
    const dt = Date.parse(pasos[i].t) - Date.parse(t0)
    if (dt <= offsetMs) idx = i
    else break
  }
  return idx
}

/** Instante en ms dentro del replay al que corresponde el paso i (0 si i < 0). */
export function offsetDePaso(pasos: readonly PasoReplay[], i: number): number {
  if (i < 0 || !pasos.length) return 0
  const clamped = Math.min(i, pasos.length - 1)
  return Math.max(0, Date.parse(pasos[clamped].t) - Date.parse(pasos[0].t))
}

export type ModoIA = Estado | 'borrador' | 'autonomo' | 'off'
