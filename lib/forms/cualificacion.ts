// CUALIFICACIÓN QUE SALE DE UN FORMULARIO (pura): las respuestas de una persona al formulario de
// captación/cualificación, en el mismo formato que ya usa Calendly (`respuestas` + claves conocidas como
// `ingresos` o `situacion`), para guardarlas en el contacto y verlas en sus agendas.
//
// Quedan fuera los datos de IDENTIDAD (nombre, email, teléfono: ya son el contacto), los textos
// informativos, los campos ocultos y el consentimiento: no son respuestas de cualificación.

import { mapKey, slugify } from '@/lib/qualification'
import type { Answers, FormConfig, Question } from './types'

const FUERA: readonly Question['type'][] = ['statement', 'hidden', 'consent', 'booking']

function texto(q: Question, valor: unknown): string {
  const etiqueta = (v: unknown) => q.options?.find((o) => o.value === String(v))?.label ?? String(v)
  if (Array.isArray(valor)) return valor.map(etiqueta).join(', ')
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  return etiqueta(valor)
}

export function cualificacionDeFormulario(
  config: FormConfig,
  answers: Answers,
  formId: string
): Record<string, unknown> {
  const respuestas: { q: string; a: string }[] = []
  const cualificacion: Record<string, unknown> = {}
  for (const q of config.questions) {
    if (FUERA.includes(q.type) || q.semantic?.startsWith('contact.')) continue
    const valor = answers[q.id]
    if (valor === undefined || valor === null || valor === '' || (Array.isArray(valor) && valor.length === 0)) continue
    const a = texto(q, valor).trim()
    if (!a) continue
    const clave = q.semantic?.startsWith('qualification.') ? q.semantic.slice('qualification.'.length) : mapKey(q.title)
    respuestas.push({ q: q.title, a })
    cualificacion[clave || slugify(q.title)] = a
  }
  if (respuestas.length === 0) return {}
  cualificacion.respuestas = respuestas
  cualificacion.origen = 'formulario'
  cualificacion.formulario_id = formId
  return cualificacion
}
