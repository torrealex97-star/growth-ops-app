// RESPUESTA DE TYPEFORM, NORMALIZADA.
//
// Puro (sin red ni base de datos): recibe el cuerpo del webhook y devuelve lo que la app necesita —
// quién es la persona, qué contestó, para qué sirve el formulario y si trae una nota. Todo lo que se
// decide con el payload vive aquí para poder probarlo; el webhook solo orquesta.
//
// FORMA DEL PAYLOAD (webhook de Typeform):
//   { event_id, event_type: 'form_response', form_response: { form_id, token, submitted_at,
//     hidden: {…}, definition: { title, fields: [{ id, ref, type, title }] },
//     answers: [{ type, field: { id, ref, type }, text | email | phone_number | number | boolean |
//                 choice | choices | url | date }] } }
//
// PARA QUÉ SIRVE CADA FORMULARIO. Por defecto es de CUALIFICACIÓN de leads (el que hace la persona
// antes de agendar). Un formulario es de FEEDBACK cuando (1) su URL lleva el campo oculto
// `purpose=feedback` (o `tipo=feedback`), o (2) su id está en TYPEFORM_FEEDBACK_FORMS. El campo oculto
// manda sobre la lista: el equipo puede reutilizar un formulario sin tocar la configuración.

import { extraerRespuestas } from '@/lib/metrics/respuestas-formulario'
import { mapKey, slugify } from '@/lib/qualification'

type Json = Record<string, unknown>
const esObjeto = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

export type PropositoFormulario = 'lead' | 'feedback'

export type RespuestaTypeform = {
  /** Id de la respuesta en Typeform: base de la idempotencia (un reintento es la misma respuesta). */
  token: string
  formId: string
  formTitulo: string | null
  enviadoEn: string | null
  proposito: PropositoFormulario
  email: string | null
  telefono: string | null
  nombre: string | null
  apellidos: string | null
  instagram: string | null
  edad: number | null
  /** Pares pregunta/respuesta, listos para `contacts.qualification.respuestas`. */
  respuestas: { q: string; a: string }[]
  /** Cualificación en el formato que ya usa Calendly: claves conocidas + el resto por slug. */
  cualificacion: Record<string, unknown>
  /** Campos ocultos de la URL (UTMs y similares), planos. */
  ocultos: Record<string, string>
  /** Nota 0-10 si el formulario trae una escala (opinion_scale / rating); `null` si no la trae. */
  nota: number | null
}

const CAMPOS_ESCALA = new Set(['opinion_scale', 'rating', 'nps'])

export function propositoDe(
  ocultos: Record<string, string>,
  formId: string,
  formulariosFeedback: readonly string[]
): PropositoFormulario {
  const declarado = (ocultos.purpose || ocultos.tipo || ocultos.proposito || '').trim().toLowerCase()
  if (declarado === 'feedback') return 'feedback'
  if (declarado === 'lead' || declarado === 'cualificacion') return 'lead'
  return formulariosFeedback.includes(formId) ? 'feedback' : 'lead'
}

/** `TYPEFORM_FEEDBACK_FORMS`: ids separados por coma, espacios o saltos de línea. */
export function listaFormulariosFeedback(valor: string | undefined | null): string[] {
  return (valor ?? '')
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function normalizarRespuestaTypeform(
  payload: unknown,
  formulariosFeedback: readonly string[] = []
): RespuestaTypeform | null {
  if (!esObjeto(payload)) return null
  const fr = payload.form_response
  if (!esObjeto(fr)) return null
  const token = texto(fr.token) || texto(payload.event_id)
  const formId = texto(fr.form_id)
  if (!token || !formId) return null

  const definicion = esObjeto(fr.definition) ? fr.definition : {}
  const respuestasRaw = Array.isArray(fr.answers) ? fr.answers.filter(esObjeto) : []

  // Campos ocultos: solo valores de texto simples (los anidados no son UTMs).
  const ocultos: Record<string, string> = {}
  if (esObjeto(fr.hidden)) {
    for (const [k, v] of Object.entries(fr.hidden)) {
      const t = texto(v)
      if (t && typeof v !== 'object') ocultos[k] = t
    }
  }

  const pares = extraerRespuestas(payload)
  const respuestas = pares.map((p) => ({ q: p.pregunta, a: p.respuesta }))

  const cualificacion: Record<string, unknown> = {}
  let telefonoDelFormulario: string | null = null
  let instagram: string | null = null
  let edad: number | null = null
  let nombre: string | null = null
  let apellidos: string | null = null
  for (const { q, a } of respuestas) {
    const clave = mapKey(q)
    cualificacion[clave || slugify(q)] = a
    if (clave === 'telefono' && !telefonoDelFormulario) telefonoDelFormulario = a.replace(/[^\d+]/g, '') || null
    if (clave === 'instagram') instagram = a.replace(/^@/, '').trim() || null
    if (clave === 'edad') {
      const m = a.match(/\d{1,3}/)
      if (m) edad = parseInt(m[0], 10)
    }
    const titulo = q.toLowerCase()
    if (!nombre && /^(nombre|name|first name|tu nombre|¿cómo te llamas)/.test(titulo) && !/apellid/.test(titulo)) {
      nombre = a
    }
    if (!apellidos && /apellid|last name|surname/.test(titulo)) apellidos = a
  }
  cualificacion.respuestas = respuestas
  cualificacion.origen = 'typeform'
  cualificacion.typeform_form_id = formId

  // Email y teléfono por TIPO de respuesta (lo fiable); el campo oculto `email` solo como respaldo.
  let email: string | null = null
  let telefono: string | null = null
  let nota: number | null = null
  const tipoDeCampo = new Map<string, string>()
  if (Array.isArray(definicion.fields)) {
    for (const f of definicion.fields.filter(esObjeto)) {
      if (typeof f.id === 'string') tipoDeCampo.set(f.id, texto(f.type))
    }
  }
  for (const a of respuestasRaw) {
    const campo = esObjeto(a.field) ? a.field : {}
    if (!email && typeof a.email === 'string' && a.email.trim()) email = a.email.trim().toLowerCase()
    if (!telefono && typeof a.phone_number === 'string' && a.phone_number.trim()) {
      telefono = a.phone_number.replace(/[^\d+]/g, '') || null
    }
    const tipo = tipoDeCampo.get(texto(campo.id)) || texto(campo.type)
    if (nota === null && CAMPOS_ESCALA.has(tipo) && typeof a.number === 'number' && Number.isFinite(a.number)) {
      // opinion_scale ya es 0-10 (o 1-10); rating llega en 1-5 y se lleva a 0-10 para que todas las
      // notas sean comparables. Una escala de otro tamaño se acota, no se inventa.
      const bruta = tipo === 'rating' && a.number <= 5 ? a.number * 2 : a.number
      nota = Math.max(0, Math.min(10, Math.round(bruta)))
    }
  }
  if (!email && ocultos.email && /.+@.+\..+/.test(ocultos.email)) email = ocultos.email.toLowerCase()
  if (!telefono) telefono = telefonoDelFormulario

  return {
    token,
    formId,
    formTitulo: texto(definicion.title) || null,
    enviadoEn: texto(fr.submitted_at) || null,
    proposito: propositoDe(ocultos, formId, formulariosFeedback),
    email,
    telefono,
    nombre,
    apellidos,
    instagram,
    edad,
    respuestas,
    cualificacion,
    ocultos,
    nota,
  }
}

/**
 * Combina la cualificación NUEVA con la que el contacto ya tenía. Lo nuevo gana en las claves que
 * trae; lo que Typeform no preguntó (y Calendly sí) se conserva. Las `respuestas` se unen sin repetir
 * la misma pregunta: gana la más reciente.
 */
export function fusionarCualificacion(
  previa: Record<string, unknown> | null | undefined,
  nueva: Record<string, unknown>
): Record<string, unknown> {
  const base = previa && esObjeto(previa) ? previa : {}
  const resultado: Record<string, unknown> = { ...base, ...nueva }
  const previas = Array.isArray(base.respuestas) ? (base.respuestas as { q: string; a: string }[]) : []
  const nuevas = Array.isArray(nueva.respuestas) ? (nueva.respuestas as { q: string; a: string }[]) : []
  const preguntasNuevas = new Set(nuevas.map((r) => r.q.trim().toLowerCase()))
  resultado.respuestas = [...previas.filter((r) => !preguntasNuevas.has(r.q.trim().toLowerCase())), ...nuevas]
  return resultado
}
