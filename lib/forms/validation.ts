// Validación de respuestas, compartida por el navegador (feedback inmediato) y por el servidor
// (que es quien decide: NUNCA se confía en lo que valida el cliente).

import { getPathAnswers, walkPath } from './logic'
import {
  MAX_ANSWER_CHARS,
  type Answer,
  type Answers,
  type FormConfig,
  type FormVariables,
  type Question,
} from './types'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const OTHER_PREFIX = 'other:'

const isEmpty = (v: Answer | undefined): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

export const OTHER_VALUE_PREFIX = OTHER_PREFIX

function optionValues(q: Question): string[] {
  return (q.options ?? []).map((o) => o.value)
}

function validChoice(q: Question, value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (optionValues(q).includes(value)) return true
  return !!q.allowOther && value.startsWith(OTHER_PREFIX) && value.length > OTHER_PREFIX.length
}

export function maxForScale(q: Question): number {
  if (q.type === 'nps') return 10
  const m = q.scaleMax ?? 5
  return Math.min(Math.max(Math.trunc(m), 2), 10)
}

/** `null` = válida. Mensajes en español, pensados para mostrarse tal cual bajo el campo. */
export function validateAnswer(
  q: Question,
  value: Answer | undefined,
  opts: { partial?: boolean } = {}
): string | null {
  if (q.type === 'statement' || q.type === 'hidden') return null

  if (isEmpty(value)) {
    return q.required && !opts.partial ? 'Esta pregunta es obligatoria.' : null
  }

  switch (q.type) {
    case 'shortText':
    case 'longText': {
      if (typeof value !== 'string') return 'Respuesta no válida.'
      const cap = Math.min(q.maxLength ?? (q.type === 'shortText' ? 500 : MAX_ANSWER_CHARS), MAX_ANSWER_CHARS)
      if (value.length > cap) return `Máximo ${cap} caracteres.`
      if (q.minLength && value.trim().length < q.minLength) return `Mínimo ${q.minLength} caracteres.`
      if (q.pattern) {
        try {
          if (!new RegExp(q.pattern).test(value)) return q.patternMessage || 'El formato no es válido.'
        } catch {
          // Un patrón roto lo arregla quien edita el formulario; no bloquea a quien lo rellena.
        }
      }
      return null
    }
    case 'email':
      return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value.trim())
        ? null
        : 'Introduce un email válido.'
    case 'phone': {
      if (typeof value !== 'string') return 'Introduce un teléfono válido.'
      const digits = value.replace(/\D/g, '')
      return digits.length >= 6 && digits.length <= 15 && /^\+?[\d\s().-]+$/.test(value)
        ? null
        : 'Introduce un teléfono válido.'
    }
    case 'url': {
      if (typeof value !== 'string' || value.length > 2000) return 'Introduce una URL válida.'
      try {
        const u = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
        return u.hostname.includes('.') ? null : 'Introduce una URL válida.'
      } catch {
        return 'Introduce una URL válida.'
      }
    }
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(n)) return 'Introduce un número.'
      if (q.min !== undefined && n < q.min) return `El mínimo es ${q.min}.`
      if (q.max !== undefined && n > q.max) return `El máximo es ${q.max}.`
      return null
    }
    case 'date': {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Introduce una fecha válida.'
      return Number.isNaN(Date.parse(value)) ? 'Introduce una fecha válida.' : null
    }
    case 'singleChoice':
    case 'dropdown':
      return validChoice(q, value) ? null : 'Elige una de las opciones.'
    case 'multiChoice': {
      if (!Array.isArray(value) || !value.every((v) => validChoice(q, v))) return 'Elige entre las opciones.'
      if (new Set(value).size !== value.length) return 'Opciones repetidas.'
      if (q.min !== undefined && value.length < q.min) return `Elige al menos ${q.min}.`
      if (q.max !== undefined && value.length > q.max) return `Elige como máximo ${q.max}.`
      return null
    }
    case 'yesNo':
      return value === 'yes' || value === 'no' ? null : 'Elige Sí o No.'
    case 'rating':
    case 'scale': {
      const n = typeof value === 'number' ? value : Number(value)
      return Number.isInteger(n) && n >= 1 && n <= maxForScale(q) ? null : 'Elige una valoración.'
    }
    case 'nps': {
      const n = typeof value === 'number' ? value : Number(value)
      return Number.isInteger(n) && n >= 0 && n <= 10 ? null : 'Elige un valor de 0 a 10.'
    }
    case 'consent':
      return value === true || value === 'true' ? null : q.required ? 'Debes aceptar para continuar.' : null
    case 'booking':
      return typeof value === 'string' && value.length <= 500 ? null : 'Reserva no válida.'
    default:
      return null
  }
}

export interface SubmissionCheck {
  ok: boolean
  errors: Record<string, string>
  /** Solo las respuestas del camino real, ya saneadas. Es lo único que debe guardarse. */
  answers: Answers
  questionIds: string[]
  endingId: string | null
}

/**
 * Valida un envío contra la versión publicada: claves desconocidas, obligatorias del camino real y
 * formato de cada valor. `partial` (captura progresiva) no exige las obligatorias.
 */
export function validateSubmission(
  config: FormConfig,
  raw: Answers,
  vars: FormVariables = {},
  opts: { partial?: boolean } = {}
): SubmissionCheck {
  const errors: Record<string, string> = {}
  const known = new Set(config.questions.map((q) => q.id))
  for (const key of Object.keys(raw)) {
    if (!known.has(key)) errors[key] = 'Pregunta desconocida.'
  }

  const path = walkPath(config, raw, vars)
  const byId = new Map(config.questions.map((q) => [q.id, q]))
  for (const id of path.questionIds) {
    const q = byId.get(id)
    if (!q) continue
    const err = validateAnswer(q, raw[id], opts)
    if (err) errors[id] = err
  }
  return {
    ok: Object.keys(errors).length === 0,
    errors,
    answers: getPathAnswers(config, raw, vars),
    questionIds: path.questionIds,
    endingId: path.endingId,
  }
}

/**
 * Problemas estructurales que impiden PUBLICAR: ids duplicados, saltos a ninguna parte, opciones
 * vacías, finales inexistentes. Se muestra en el constructor antes de dejar publicar.
 */
export function validateConfig(config: FormConfig): string[] {
  const problems: string[] = []
  const ids = [...config.questions.map((q) => q.id), ...config.endings.map((e) => e.id)]
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) problems.push(`Identificador repetido: "${id}".`)
    seen.add(id)
  }
  if (!config.questions.some((q) => q.type !== 'hidden' && q.type !== 'statement')) {
    problems.push('El formulario necesita al menos una pregunta.')
  }
  if (config.endings.length === 0) problems.push('Falta al menos un final.')
  for (const q of config.questions) {
    if (!q.title.trim() && q.type !== 'hidden') problems.push(`La pregunta "${q.id}" no tiene título.`)
    if (['singleChoice', 'multiChoice', 'dropdown'].includes(q.type) && (q.options ?? []).length < 2) {
      problems.push(`"${q.title || q.id}" necesita al menos dos opciones.`)
    }
    if (q.type === 'hidden' && !q.hiddenKey) problems.push(`El campo oculto "${q.id}" necesita un parámetro.`)
    if (q.showIf) {
      for (const c of q.showIf.conditions) {
        if (!c.questionId.startsWith('$') && !config.questions.some((x) => x.id === c.questionId)) {
          problems.push(`"${q.title || q.id}" depende de una pregunta que no existe.`)
        }
      }
    }
  }
  const targets = new Set(ids)
  for (const r of config.logic) {
    if (!config.questions.some((q) => q.id === r.from)) problems.push(`Regla ${r.id}: la pregunta de origen no existe.`)
    const target = r.then.type === 'jump' ? r.then.target : r.then.endingId
    if (!targets.has(target)) problems.push(`Regla ${r.id}: el destino no existe.`)
  }
  return problems
}
