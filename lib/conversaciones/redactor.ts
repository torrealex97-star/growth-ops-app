// REDACTOR DEL AGENTE DE SETTING (puro): construye el prompt y VALIDA la respuesta del modelo.
//
// La IA solo redacta. Todo lo que devuelve pasa por `validarBorrador` ANTES de enviarse o de ofrecerse como
// borrador: si incumple una regla dura, se descarta y la conversación se traspasa a una persona. Es la segunda
// barrera (la primera es `decidirAgente`/`evaluarTraspaso`, que corren antes de llamar al modelo).

export type PasoGuion = {
  /** Clave del dato que se quiere averiguar (se guarda en la cualificación del contacto: ingresos, situacion…). */
  clave: string
  /** Lo que el agente quiere saber, en una frase. */
  objetivo: string
  /** Formulación sugerida; el agente la adapta al tono, no la copia a ciegas. */
  pregunta?: string
}

export type Objecion = { disparador: string; respuesta: string }

export type GuionAgente = {
  negocio: string
  tono: string
  pasos: readonly PasoGuion[]
  objeciones: readonly Objecion[]
  /** Enlace de agenda; es lo ÚNICO que el agente puede enviar como URL. */
  enlaceAgenda: string | null
  /** Datos que NO puede inventar y sí repetir (qué incluye el programa, para quién es). Sin precios. */
  hechosPermitidos: readonly string[]
}

export type Turno = { autor: 'lead' | 'humano' | 'ia'; texto: string }

const MAX_TURNOS = 24

/** Pasos del guion cuyo dato aún no se conoce (`conocidos`: claves ya guardadas en la cualificación del contacto). */
export function pasosPendientes(pasos: readonly PasoGuion[], conocidos: ReadonlySet<string>): PasoGuion[] {
  return pasos.filter((p) => !conocidos.has(p.clave))
}

export function construirPrompt(
  guion: GuionAgente,
  conocidos: ReadonlySet<string>,
  turnos: readonly Turno[],
  resumen: string | null
) {
  const pendientes = pasosPendientes(guion.pasos, conocidos)
  const sistema = [
    `Eres el asistente de mensajes directos de ${guion.negocio}. Hablas con una persona real por Instagram.`,
    `Tono: ${guion.tono}. Mensajes cortos (1-3 frases), naturales, sin listas ni emojis en exceso, en el idioma del lead.`,
    'OBJETIVO: entender su situación con UNA pregunta cada vez y, cuando encaje, proponerle una llamada.',
    pendientes.length
      ? `Lo que aún no sabes (pregunta solo UNA cosa por mensaje, la primera que encaje):\n${pendientes.map((p, i) => `${i + 1}. ${p.objetivo}${p.pregunta ? ` (p. ej.: «${p.pregunta}»)` : ''}`).join('\n')}`
      : 'Ya tienes los datos necesarios: propón la llamada.',
    guion.enlaceAgenda
      ? `Para agendar, envía EXACTAMENTE este enlace y ninguno más: ${guion.enlaceAgenda}`
      : 'No tienes enlace de agenda: no prometas llamadas, di que una persona del equipo le escribirá.',
    guion.hechosPermitidos.length
      ? `Puedes repetir estos hechos, sin añadir nada:\n- ${guion.hechosPermitidos.join('\n- ')}`
      : '',
    guion.objeciones.length
      ? `Si pone una objeción parecida a estas, responde con esta idea:\n${guion.objeciones.map((o) => `- «${o.disparador}» → ${o.respuesta}`).join('\n')}`
      : '',
    'REGLAS DURAS (si no puedes cumplirlas, responde solo la palabra TRASPASO):',
    '- Nunca des ni insinúes precios, descuentos, financiación, garantías, plazos ni condiciones.',
    '- Nunca inventes datos, resultados, testimonios ni cifras. Si no lo sabes, responde TRASPASO.',
    '- Nunca pidas ni aceptes datos de pago, DNI, IBAN ni contraseñas.',
    '- Nunca afirmes que eres una persona; si te lo preguntan, responde TRASPASO.',
    '- Un solo mensaje, sin saludos repetidos.',
  ]
    .filter(Boolean)
    .join('\n\n')
  const recientes = turnos.slice(-MAX_TURNOS)
  const mensajes = recientes.map((t) => ({
    role: t.autor === 'lead' ? ('user' as const) : ('assistant' as const),
    content: t.texto,
  }))
  return { system: resumen ? `${sistema}\n\nResumen de lo hablado antes:\n${resumen}` : sistema, messages: mensajes }
}

export type ResultadoValidacion = { ok: true; texto: string } | { ok: false; traspasar: true; motivo: string }

const PRECIO =
  /(\d+\s?(€|eur|euros|usd|\$|dolares)|\b(precio|descuento|rebaja|financiaci|cuotas|garantia|reembols|devoluci)\w*)/i
const PAGO = /\b(iban|tarjeta|cvv|dni|contrasena|contraseña|password|transferencia)\b/i
const URL = /https?:\/\/[^\s)]+/gi
const SOY_PERSONA = /\b(soy (una )?persona|no soy (un )?(bot|robot|ia)|soy humano)\b/i
const MAX_CARACTERES = 900

/**
 * Valida el texto del modelo. Rechaza (→ traspaso): vacío, `TRASPASO`, demasiado largo, precios o condiciones,
 * datos de pago, afirmar ser persona, y CUALQUIER enlace distinto del de agenda configurado.
 */
export function validarBorrador(textoModelo: string, enlaceAgenda: string | null): ResultadoValidacion {
  const texto = (textoModelo ?? '').trim()
  const rechazo = (motivo: string): ResultadoValidacion => ({ ok: false, traspasar: true, motivo })
  if (!texto) return rechazo('respuesta vacía')
  if (/^traspaso\b/i.test(texto)) return rechazo('el modelo pidió traspaso')
  if (texto.length > MAX_CARACTERES) return rechazo('respuesta demasiado larga')
  if (PRECIO.test(texto)) return rechazo('menciona precio o condiciones')
  if (PAGO.test(texto)) return rechazo('menciona datos de pago')
  if (SOY_PERSONA.test(texto)) return rechazo('afirma ser una persona')
  for (const u of texto.match(URL) ?? []) {
    const limpia = u.replace(/[.,;!?]+$/, '')
    if (!enlaceAgenda || limpia !== enlaceAgenda) return rechazo('incluye un enlace no autorizado')
  }
  return { ok: true, texto }
}
