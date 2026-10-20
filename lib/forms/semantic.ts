// Extrae de las respuestas lo que significan (nombre, email, valoración, profesor…), según el rol
// semántico de cada pregunta. Es el puente entre un formulario libre y el resto de la app: contactos,
// NPS de alumnos y dashboard de profesores no conocen ids de pregunta, solo roles.

import type { Answer, Answers, FormConfig } from './types'

export interface SemanticValues {
  name: string | null
  email: string | null
  phone: string | null
  rating: number | null
  nps: number | null
  teacher: string | null
  module: string | null
  class: string | null
  qualification: Record<string, string>
}

const asText = (v: Answer | undefined, labelOf?: (x: string) => string): string | null => {
  if (v === undefined || v === null || v === '') return null
  const raw = Array.isArray(v) ? v.join(', ') : String(v)
  const text = labelOf && !Array.isArray(v) ? labelOf(raw) : raw
  return text.trim() ? text.trim().slice(0, 500) : null
}

const asNum = (v: Answer | undefined): number | null => {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

export function extractSemantic(config: FormConfig, pathAnswers: Answers): SemanticValues {
  const out: SemanticValues = {
    name: null,
    email: null,
    phone: null,
    rating: null,
    nps: null,
    teacher: null,
    module: null,
    class: null,
    qualification: {},
  }
  for (const q of config.questions) {
    if (!q.semantic) continue
    const v = pathAnswers[q.id]
    // Para profesor/módulo/clase se guarda la ETIQUETA legible, no el valor interno de la opción.
    const label = (x: string) => q.options?.find((o) => o.value === x)?.label ?? x.replace(/^other:/, '')
    switch (q.semantic) {
      case 'contact.name':
        out.name = asText(v)
        break
      case 'contact.email':
        out.email = asText(v)?.toLowerCase() ?? null
        break
      case 'contact.phone':
        out.phone = asText(v)
        break
      case 'rating':
        out.rating = asNum(v)
        break
      case 'nps':
        out.nps = asNum(v)
        break
      case 'teacher':
        out.teacher = asText(v, label)
        break
      case 'module':
        out.module = asText(v, label)
        break
      case 'class':
        out.class = asText(v, label)
        break
      default:
        if (q.semantic.startsWith('qualification.')) {
          const t = asText(v, label)
          if (t) out.qualification[q.semantic.slice('qualification.'.length)] = t
        }
    }
  }
  return out
}
