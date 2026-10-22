// TRASPASO A HUMANO (puro). Decide en código, por señales, cuándo el agente deja de responder y avisa al equipo.
// Es deliberadamente CONSERVADOR: ante la duda, traspasa. Un traspaso de más cuesta un minuto de un setter;
// una respuesta de más a un lead enfadado o que pregunta por dinero puede costar la venta o la reputación.

export type MotivoTraspaso =
  | 'pide_humano'
  | 'enfado'
  | 'baja_o_stop'
  | 'precio_o_condiciones'
  | 'intencion_alta'
  | 'datos_sensibles'
  | 'sin_confianza'

export type SenalTraspaso = { traspasar: boolean; motivo: MotivoTraspaso | null; detalle: string }

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

const REGLAS: { motivo: MotivoTraspaso; detalle: string; re: RegExp }[] = [
  {
    motivo: 'baja_o_stop',
    detalle: 'El lead pide que no le escriban más.',
    re: /\b(stop|baja|darme de baja|no me escribas|no me escriban|no quiero (mas )?mensajes|dejad de escribirme|deja de escribirme|spam)\b/,
  },
  {
    motivo: 'pide_humano',
    detalle: 'El lead pide hablar con una persona.',
    re: /\b(hablar con (una )?(persona|humano|alguien)|eres (un )?(bot|robot|ia)|es(ta)? (un )?(bot|robot)|quiero (una )?llamada|pasame con|pasadme con)\b/,
  },
  {
    motivo: 'enfado',
    detalle: 'El lead muestra enfado o queja.',
    re: /\b(estafa|timo|fraude|denunci|reclam|inaceptable|verguenza|harto|harta|pesimo|basura|no me contesta|me habeis engan)/,
  },
  {
    motivo: 'datos_sensibles',
    detalle: 'El lead comparte datos de pago o personales sensibles.',
    re: /\b(\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}|iban|es\d{2}\s?\d{4}|contrasena|password|dni|nie)\b/,
  },
  {
    motivo: 'precio_o_condiciones',
    detalle: 'Pregunta por precio, descuento, financiación o condiciones: lo responde una persona.',
    re: /\b(cuanto (cuesta|vale|es)\b|precio|tarifa|descuento|rebaja|financia|cuotas|plazos|reembols|devoluci|garantia|factura|contrato)/,
  },
  {
    motivo: 'intencion_alta',
    detalle: 'Intención de compra alta: pasa a una persona para cerrar o agendar.',
    re: /\b(quiero (empezar|apuntarme|entrar|comprar|contratar|reservar)|como (me )?apunto|donde (pago|firmo)|lo quiero|estoy lista|estoy listo|reservar (una )?(llamada|plaza|cita)|agendar|agenda(me)?)\b/,
  },
]

/**
 * Evalúa el ÚLTIMO mensaje del lead. `confianza` (0-1) es la que devuelva el clasificador de intención cuando
 * lo haya; sin él, no interviene. Una pregunta fuera del guion (`fueraDeGuion`) también traspasa.
 */
export function evaluarTraspaso(
  ultimoMensajeLead: string,
  opciones: { confianza?: number | null; umbralConfianza?: number; fueraDeGuion?: boolean } = {}
): SenalTraspaso {
  const t = norm(ultimoMensajeLead)
  for (const r of REGLAS) {
    if (r.re.test(t)) return { traspasar: true, motivo: r.motivo, detalle: r.detalle }
  }
  const umbral = opciones.umbralConfianza ?? 0.6
  if (typeof opciones.confianza === 'number' && opciones.confianza < umbral) {
    return { traspasar: true, motivo: 'sin_confianza', detalle: 'El agente no está seguro de qué responder.' }
  }
  if (opciones.fueraDeGuion) {
    return { traspasar: true, motivo: 'sin_confianza', detalle: 'La pregunta queda fuera del guion del agente.' }
  }
  return { traspasar: false, motivo: null, detalle: 'Sin señales de traspaso.' }
}

/** El motivo `baja_o_stop` además debe marcar al contacto como «no escribir» (sin más mensajes automáticos). */
export const exigeNoContactar = (m: MotivoTraspaso | null): boolean => m === 'baja_o_stop'
