// CREAR UN FORMULARIO HABLANDO CON LA IA.
//
// La persona describe con texto el formulario que quiere. La IA hace UNA de dos cosas en cada turno:
//   · preguntar lo que le falta (para quién es, qué quiere saber, qué pasa al terminar…), o
//   · devolver el formulario completo.
// Con el formulario ya propuesto, la misma conversación sirve para pedir cambios («quita el teléfono»,
// «añade una pregunta de presupuesto»): se le pasa el formulario actual y devuelve el nuevo entero.
//
// LA IA NO ESCRIBE EN LA BASE DE DATOS. Devuelve una propuesta; lo que se guarda es lo que sale de
// `sanearConfig` (lib/forms/normalizar.ts), que es lo único que decide qué es una config válida. Y se guarda
// como BORRADOR cuando la persona pulsa «Crear»: nada se publica solo.
//
// El motor es el de la subcuenta (lib/ai/provider.ts: DeepSeek → Anthropic → Groq).

import { completeConversation, type AiEnv, type AiMessage } from '@/lib/ai/provider'
import { sanearConfig } from './normalizar'
import { FORM_AUDIENCES, FORM_CATEGORIES, type FormAudience, type FormCategory, type FormConfig } from './types'

/** Tras estas rondas de preguntas la IA ya no puede preguntar más: crea con supuestos y los declara. */
export const MAX_RONDAS_PREGUNTAS = 3
export const MAX_MENSAJES = 24
/** Las rutas tienen 60 s (Free Tier): la corrección solo se pide si la primera respuesta llegó antes de esto. */
export const PRESUPUESTO_REINTENTO_MS = 25_000
export const MAX_CARACTERES_MENSAJE = 6000

export type TurnoCreador = { role: 'user' | 'assistant'; content: string }

export type PropuestaFormulario = {
  name: string
  category: FormCategory
  audience: FormAudience
  config: FormConfig
}

export type RespuestaCreador =
  | { type: 'questions'; message: string; questions: string[] }
  | ({ type: 'form'; message: string; avisos: string[] } & PropuestaFormulario)

export const PROMPT_CREADOR = `Eres quien diseña formularios en una plataforma de captación y ventas. La persona te describe el formulario que quiere y tú lo construyes. Escribes siempre en español de España, tuteando, claro y sin relleno.

CÓMO TRABAJAS
1. Si te falta algo IMPRESCINDIBLE para hacerlo bien, pregunta. Como mucho 3 preguntas por turno, concretas, y solo las que cambian el formulario: para quién es y qué objetivo tiene, qué datos necesita sí o sí, si hay que puntuar/filtrar a quien responde, y qué pasa al terminar (mensaje, enlace o agenda).
2. No preguntes lo que puedas decidir con criterio (redacción, orden, textos de bienvenida). Decídelo tú.
3. En cuanto tengas lo esencial, crea el formulario. Si asumes algo, dilo en "message".
4. Si te pasan un FORMULARIO ACTUAL, aplica el cambio que piden y devuelve el formulario ENTERO, conservando los ids de lo que no cambia.
5. Si te pegan las preguntas de un formulario de otra herramienta, reprodúcelas fielmente (mismo orden y opciones) en vez de inventar otras.

CRITERIO DE DISEÑO
- Una idea por pregunta. Corto: de 4 a 9 preguntas salvo que pidan otra cosa. Cada pregunta de más baja la conversión.
- Empieza por lo fácil. Si es captación o cualificación de clientes, pide nombre, email y teléfono.
- Para filtrar clientes de un servicio de precio alto, lo que más predice es: su situación actual, el objetivo que busca, lo que le frena y si puede y quiere invertir ahora. Pregúntalo con opciones cerradas, no con texto libre.
- Opciones cerradas siempre que se pueda (se contestan más y se pueden puntuar). Texto libre solo para matices.
- Nunca uses emojis en ningún texto.
- No inventes datos del negocio (precios, nombres, enlaces). Si necesitas un enlace y no te lo han dado, no lo pongas.

FORMATO DE RESPUESTA
Responde SOLO con un objeto JSON, sin texto antes ni después y sin bloque de código. Una de estas dos formas:

{"type":"questions","message":"frase breve","questions":["pregunta 1","pregunta 2"]}

{"type":"form","message":"qué has montado y qué has asumido, en 1-3 frases","name":"Nombre interno del formulario","category":"<categoría>","audience":"<audiencia>","config":{ ... }}

category: una de ${FORM_CATEGORIES.join(', ')}.
audience: una de ${FORM_AUDIENCES.join(', ')} (captacion = leads nuevos; cualificacion = filtrar clientes; empleados = candidaturas; alumnos = feedback de alumnos y clientes).

ESQUEMA DE "config"
{
  "welcome": {"title":"...","subtitle":"...","cta":"Empezar","estimatedTime":"2 minutos"},
  "questions": [ pregunta, ... ],
  "logic": [ regla, ... ],
  "endings": [ final, ... ],
  "scoring": {"enabled":true,"thresholds":{"caliente":70,"templado":40},"weights":[peso, ...]}
}

pregunta = {"id":"minusculas-con-guiones","type":"<tipo>","title":"...","help":"...","required":true,"placeholder":"...","options":[{"value":"minusculas","label":"Texto visible"}],"allowOther":true,"semantic":"...","showIf":grupo}
Tipos: shortText (texto corto), longText (texto largo), email, phone, number, url, date, singleChoice (una opción), multiChoice (varias), dropdown (desplegable, para listas largas), yesNo (responde "yes" o "no"), rating (estrellas, "scaleMax" 5 por defecto), nps (0 a 10), scale (escala, "scaleMax" y "scaleLabels":{"min":"...","max":"..."}), statement (texto informativo, no pregunta nada), consent (casilla de aceptación; el texto de la casilla va en "placeholder"), booking (agenda embebida; SOLO si te dan la URL https del calendario, que va en "defaultValue"), hidden (dato de la URL; "hiddenKey" es el nombre del parámetro, p. ej. utm_source).
singleChoice, multiChoice y dropdown necesitan al menos 2 opciones.
"semantic" (opcional): "contact.name", "contact.email", "contact.phone" para los datos de contacto; "qualification.<clave_en_minusculas>" para respuestas de cualificación (p. ej. qualification.facturacion); "rating" y "nps" para valoraciones.

grupo = {"match":"all"|"any","conditions":[{"questionId":"id-de-pregunta","op":"equals|notEquals|in|notIn|contains|gt|gte|lt|lte|isAnswered|isEmpty","value":"..."}]}
En una condición, "questionId" también puede ser "$score" (puntos, 0-100) o "$temperature" ("caliente", "templado", "frio") si hay scoring.

regla = {"from":"id-de-pregunta","when":grupo,"then":{"type":"jump","target":"id-de-pregunta"} o {"type":"end","endingId":"id-de-final"}}
Se evalúa al salir de la pregunta "from". Úsalas solo si hace falta saltar o cortar el formulario; para ocultar una pregunta usa "showIf".

final = {"id":"...","title":"...","message":"...","ctaLabel":"...","ctaUrl":"https://...","redirectUrl":"https://...","when":grupo}
Tiene que haber un final sin "when" (el de por defecto), y va el último. Los finales con "when" se evalúan en orden.

peso = {"questionId":"...","value":"valor-de-opcion","points":30} (o "in":["a","b"], o "gte"/"lte" para respuestas numéricas)
"scoring" solo si hay que puntuar o filtrar. Los puntos de la mejor combinación deben sumar alrededor de 100.`

/** Saca el objeto JSON de la respuesta del modelo aunque venga envuelto en un bloque de código o con texto. */
export function extraerJson(texto: string): unknown {
  const limpio = texto.replace(/```(?:json)?/gi, '').trim()
  const desde = limpio.indexOf('{')
  const hasta = limpio.lastIndexOf('}')
  if (desde === -1 || hasta <= desde) throw new Error('La respuesta no contiene un objeto JSON.')
  try {
    return JSON.parse(limpio.slice(desde, hasta + 1))
  } catch {
    throw new Error('La respuesta no es un JSON válido (¿se cortó a medias?).')
  }
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Interpreta lo que devolvió el modelo. Lanza con un motivo legible (se le devuelve al modelo para que corrija). */
export function interpretarRespuesta(texto: string): RespuestaCreador {
  const j = extraerJson(texto)
  if (!esObjeto(j)) throw new Error('La respuesta no es un objeto JSON.')
  if (j.type === 'questions') {
    const questions = (Array.isArray(j.questions) ? j.questions : [])
      .map((q) => txt(q, 400))
      .filter(Boolean)
      .slice(0, 4)
    const message = txt(j.message, 600)
    if (questions.length === 0 && !message) throw new Error('"questions" está vacío.')
    return { type: 'questions', message, questions }
  }
  if (j.type === 'form') {
    const { config, avisos } = sanearConfig(j.config)
    return {
      type: 'form',
      message: txt(j.message, 1200),
      name: txt(j.name, 160) || config.welcome?.title || 'Formulario',
      category: (FORM_CATEGORIES as readonly string[]).includes(String(j.category))
        ? (j.category as FormCategory)
        : 'otro',
      audience: (FORM_AUDIENCES as readonly string[]).includes(String(j.audience))
        ? (j.audience as FormAudience)
        : 'captacion',
      config,
      avisos,
    }
  }
  throw new Error('"type" debe ser "questions" o "form".')
}

/** Mensajes para el modelo: el historial tal cual, más el formulario actual (si ya hay uno) en el sistema. */
export function prepararPeticion(
  turnos: TurnoCreador[],
  actual?: PropuestaFormulario | null
): { system: string; messages: AiMessage[] } {
  const messages = turnos
    .slice(-MAX_MENSAJES)
    .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_CARACTERES_MENSAJE) }))
    .filter((t) => t.content.trim())
  // El protocolo de conversación exige que empiece la persona.
  while (messages.length && messages[0].role !== 'user') messages.shift()
  let system = PROMPT_CREADOR
  if (actual) {
    system += `\n\nFORMULARIO ACTUAL (aplica sobre él lo que pida el último mensaje y devuélvelo entero con "type":"form"; si lo que piden no está claro, pregunta):\n${JSON.stringify(
      { name: actual.name, category: actual.category, audience: actual.audience, config: actual.config }
    )}`
  } else {
    const rondas = messages.filter((m) => m.role === 'assistant').length
    if (rondas >= MAX_RONDAS_PREGUNTAS) {
      system += `\n\nYA HAS PREGUNTADO SUFICIENTE. No puedes preguntar más: responde con "type":"form", decide tú lo que falte y di en "message" qué has asumido.`
    }
  }
  return { system, messages }
}

type Completar = typeof completeConversation

/**
 * Un turno de la conversación. Si el modelo devuelve algo que no se puede usar, se le dice por qué y se le
 * da UNA oportunidad de corregirlo; si vuelve a fallar se propaga el error (no se inventa un formulario).
 */
export async function turnoCreador(
  turnos: TurnoCreador[],
  actual: PropuestaFormulario | null,
  env: AiEnv,
  completar: Completar = completeConversation
): Promise<RespuestaCreador> {
  const { system, messages } = prepararPeticion(turnos, actual)
  if (messages.length === 0) throw new Error('Describe el formulario que quieres crear.')
  const pedir = (m: AiMessage[]) =>
    completar({ system, messages: m, maxTokens: 8000, temperature: 0.3, smart: true }, env)

  const inicio = Date.now()
  const primera = await pedir(messages)
  try {
    return interpretarRespuesta(primera.text)
  } catch (e) {
    const motivo = e instanceof Error ? e.message : 'formato no válido'
    if (Date.now() - inicio > PRESUPUESTO_REINTENTO_MS) {
      throw new Error(`La IA ha tardado y su respuesta no era válida (${motivo}). Vuelve a enviarlo.`)
    }
    const segunda = await pedir([
      ...messages,
      { role: 'assistant', content: primera.text.slice(0, 12000) },
      {
        role: 'user',
        content: `Tu respuesta anterior no se puede usar: ${motivo} Devuelve SOLO el objeto JSON corregido, completo, siguiendo el formato indicado.`,
      },
    ])
    try {
      return interpretarRespuesta(segunda.text)
    } catch (e2) {
      throw new Error(
        `La IA no ha devuelto un formulario válido (${e2 instanceof Error ? e2.message : 'formato no válido'}). Prueba a describirlo de otra forma.`
      )
    }
  }
}
