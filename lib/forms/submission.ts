// Evaluación de un envío en el servidor: valida contra la versión publicada, puntúa, resuelve el
// final (con la temperatura ya calculada) y la redirección. Es pura (sin BD) para poder probarla;
// la ruta pública solo añade persistencia, contacto y límites encima.

import { pipe, pipeUrl, resolveEnding, safeRedirectUrl } from './logic'
import { computeScore, type ScoreResult } from './scoring'
import { extractSemantic, type SemanticValues } from './semantic'
import type { Answers, Ending, FormConfig } from './types'
import { validateSubmission } from './validation'

export interface EvaluateInput {
  answers: Answers
  /** Valores de la URL (`?profesor=…&utm_source=…`), por nombre de parámetro. */
  hidden?: Record<string, unknown>
  partial?: boolean
  /** Variables que inyecta el servidor (p. ej. `trustpilot_url`). */
  vars?: Record<string, string | undefined>
}

export type Evaluation =
  | { ok: false; errors: Record<string, string> }
  | {
      ok: true
      answers: Answers
      hidden: Record<string, string>
      semantic: SemanticValues
      score: ScoreResult | null
      ending: Ending | null
      endingId: string | null
      redirectUrl: string | null
      endingTitle: string | null
      endingMessage: string | null
    }

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null)

export function evaluateSubmission(config: FormConfig, input: EvaluateInput): Evaluation {
  // Los campos ocultos entran como respuesta de su pregunta `hidden`, por el parámetro de URL.
  const answers: Answers = { ...input.answers }
  const hidden: Record<string, string> = {}
  for (const q of config.questions) {
    if (q.type !== 'hidden' || !q.hiddenKey) continue
    const v = clean(input.hidden?.[q.hiddenKey]) ?? clean(q.defaultValue)
    if (v) {
      answers[q.id] = v
      hidden[q.hiddenKey] = v
    } else {
      delete answers[q.id]
    }
  }

  const check = validateSubmission(config, answers, {}, { partial: !!input.partial })
  if (!check.ok) return { ok: false, errors: check.errors }

  const score = computeScore(config, check.answers)
  const vars: Record<string, string | number | undefined> = { ...input.vars }
  if (score) {
    vars.score = score.score
    vars.temperature = score.temperature
  }
  // El final se decide AQUÍ (con $score/$temperature): el navegador no los conoce.
  const ending = resolveEnding(config, check.answers, vars)
  const redirect = ending?.redirectUrl
    ? safeRedirectUrl(pipeUrl(ending.redirectUrl, config, check.answers, vars))
    : null

  return {
    ok: true,
    answers: check.answers,
    hidden,
    semantic: extractSemantic(config, check.answers),
    score,
    ending,
    endingId: ending?.id ?? null,
    redirectUrl: redirect,
    endingTitle: ending ? pipe(ending.title, config, check.answers, vars) : null,
    endingMessage: ending?.message ? pipe(ending.message, config, check.answers, vars) : null,
  }
}
