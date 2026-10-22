// ESTADOS DE UNA CONVERSACIÓN (puro). Modelo de Chatwoot (MIT): abierta / pendiente / aplazada / resuelta.
//   · `pendiente` = la atiende el agente de IA (o espera algo); `abierta` = la tiene una persona.
//   · El TRASPASO a humano es pasar de `pendiente` a `abierta`.
//   · Un mensaje entrante reabre lo resuelto y lo aplazado.

export const ESTADOS = ['abierta', 'pendiente', 'aplazada', 'resuelta'] as const
export type Estado = (typeof ESTADOS)[number]

export const ETIQUETA_ESTADO: Record<Estado, string> = {
  abierta: 'Abierta',
  pendiente: 'Pendiente (IA)',
  aplazada: 'Aplazada',
  resuelta: 'Resuelta',
}

export const esEstado = (v: unknown): v is Estado => typeof v === 'string' && (ESTADOS as readonly string[]).includes(v)

export type EventoConversacion =
  | { tipo: 'mensaje_entrante' }
  | { tipo: 'respuesta_humana' }
  | { tipo: 'respuesta_ia' }
  | { tipo: 'traspaso_a_humano' }
  | { tipo: 'asignar_a_ia' }
  | { tipo: 'aplazar'; hasta: string }
  | { tipo: 'resolver' }
  | { tipo: 'reabrir' }

export type EstadoConversacion = { estado: Estado; aplazadaHasta: string | null }

/** Transición pura: devuelve el estado siguiente. Cualquier evento no previsto deja el estado como estaba. */
export function siguienteEstado(
  actual: EstadoConversacion,
  e: EventoConversacion,
  ahora: Date = new Date()
): EstadoConversacion {
  switch (e.tipo) {
    case 'mensaje_entrante':
      // Si estaba atendida por la IA, sigue pendiente; si no, vuelve a abierta (una persona debe verla).
      return actual.estado === 'pendiente' ? actual : { estado: 'abierta', aplazadaHasta: null }
    case 'respuesta_humana':
      return actual.estado === 'resuelta' ? actual : { estado: 'abierta', aplazadaHasta: null }
    case 'respuesta_ia':
      return actual.estado === 'resuelta' ? actual : { estado: 'pendiente', aplazadaHasta: null }
    case 'traspaso_a_humano':
      return { estado: 'abierta', aplazadaHasta: null }
    case 'asignar_a_ia':
      return { estado: 'pendiente', aplazadaHasta: null }
    case 'aplazar':
      return Date.parse(e.hasta) > ahora.getTime() ? { estado: 'aplazada', aplazadaHasta: e.hasta } : actual
    case 'resolver':
      return { estado: 'resuelta', aplazadaHasta: null }
    case 'reabrir':
      return { estado: 'abierta', aplazadaHasta: null }
    default:
      return actual
  }
}

/** Una conversación aplazada vuelve a abierta cuando llega su fecha. */
export function despertarAplazada(c: EstadoConversacion, ahora: Date = new Date()): EstadoConversacion {
  if (c.estado !== 'aplazada' || !c.aplazadaHasta) return c
  return Date.parse(c.aplazadaHasta) <= ahora.getTime() ? { estado: 'abierta', aplazadaHasta: null } : c
}
