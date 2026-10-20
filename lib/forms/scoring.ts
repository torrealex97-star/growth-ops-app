// Scoring de cualificación. Se calcula SIEMPRE en el servidor sobre las respuestas del camino real:
// los pesos no viajan al navegador público (quien conozca los pesos puede responder para salir
// "caliente"). Mismo modelo que el MVP: suma de puntos, recortada a 0-100, y umbrales de temperatura.

import type { Answer, Answers, FormConfig, Temperature } from './types'

export interface ScoreResult {
  score: number
  temperature: Temperature
  tag: string | null
}

function matches(value: Answer | undefined, w: { value?: string; in?: string[] }): boolean {
  if (value === undefined || value === null) return false
  const candidates = Array.isArray(value) ? value.map(String) : [String(value)]
  if (w.value !== undefined) return candidates.includes(w.value)
  if (w.in) return candidates.some((c) => w.in!.includes(c))
  return false
}

export function temperatureFor(score: number, thresholds: { caliente: number; templado: number }): Temperature {
  if (score >= thresholds.caliente) return 'caliente'
  if (score >= thresholds.templado) return 'templado'
  return 'frio'
}

/** `null` si el formulario no tiene scoring activo. */
export function computeScore(config: FormConfig, pathAnswers: Answers): ScoreResult | null {
  const s = config.scoring
  if (!s || !s.enabled) return null
  let total = 0
  for (const w of s.weights) {
    if (matches(pathAnswers[w.questionId], w)) total += w.points
  }
  const score = Math.max(0, Math.min(100, Math.round(total)))
  const temperature = temperatureFor(score, s.thresholds)
  const tag = s.tagPrefix ? `${s.tagPrefix}_${temperature}` : null
  return { score, temperature, tag }
}
