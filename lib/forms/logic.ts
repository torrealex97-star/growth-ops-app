// Lógica de un formulario: visibilidad, saltos, finales condicionales y piping. Todo son funciones
// puras sobre (config, respuestas): el motor del navegador y el servidor llaman a las mismas, así
// que el camino que ve la persona y el que valida el servidor no pueden divergir.
//
// REGLA CRÍTICA (heredada del MVP, donde costó datos contaminados): lo que se envía y se guarda son
// solo las respuestas del CAMINO REAL (`getPathAnswers`). Una pregunta ocultada por rama, saltada
// por un `jump` o rellenada antes de volver atrás y cambiar de rama NO debe llegar al CRM.

import type { Answer, Answers, Condition, ConditionGroup, Ending, FormConfig, FormVariables, Question } from './types'

export type Step = { kind: 'question'; id: string } | { kind: 'ending'; id: string | null }

const isEmptyValue = (v: Answer | undefined): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

const asNumber = (v: Answer | undefined): number => (typeof v === 'number' ? v : Number(v))

function lookup(id: string, answers: Answers, vars: FormVariables): Answer | undefined {
  if (id.startsWith('$')) {
    const v = vars[id.slice(1)]
    return v === undefined ? undefined : v
  }
  return answers[id]
}

function matchesCondition(c: Condition, answers: Answers, vars: FormVariables): boolean {
  const v = lookup(c.questionId, answers, vars)
  switch (c.op) {
    case 'isAnswered':
      return !isEmptyValue(v)
    case 'isEmpty':
      return isEmptyValue(v)
    case 'equals':
      if (Array.isArray(v)) return v.map(String).includes(String(c.value))
      return !isEmptyValue(v) && String(v) === String(c.value)
    case 'notEquals':
      if (Array.isArray(v)) return !v.map(String).includes(String(c.value))
      return isEmptyValue(v) || String(v) !== String(c.value)
    case 'in': {
      const list = (Array.isArray(c.value) ? c.value : [c.value]).map(String)
      if (Array.isArray(v)) return v.some((x) => list.includes(String(x)))
      return !isEmptyValue(v) && list.includes(String(v))
    }
    case 'notIn': {
      const list = (Array.isArray(c.value) ? c.value : [c.value]).map(String)
      if (Array.isArray(v)) return !v.some((x) => list.includes(String(x)))
      return isEmptyValue(v) || !list.includes(String(v))
    }
    case 'contains':
      if (Array.isArray(v)) return v.map(String).includes(String(c.value))
      return typeof v === 'string' && v.toLowerCase().includes(String(c.value ?? '').toLowerCase())
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      if (isEmptyValue(v)) return false
      const a = asNumber(v)
      const b = Number(Array.isArray(c.value) ? c.value[0] : c.value)
      if (Number.isNaN(a) || Number.isNaN(b)) return false
      return c.op === 'gt' ? a > b : c.op === 'gte' ? a >= b : c.op === 'lt' ? a < b : a <= b
    }
    default:
      return false
  }
}

/** Sin grupo (o grupo vacío) = se cumple siempre. */
export function evaluateGroup(group: ConditionGroup | undefined, answers: Answers, vars: FormVariables = {}): boolean {
  if (!group || group.conditions.length === 0) return true
  return group.match === 'any'
    ? group.conditions.some((c) => matchesCondition(c, answers, vars))
    : group.conditions.every((c) => matchesCondition(c, answers, vars))
}

export const isQuestionVisible = (q: Question, answers: Answers, vars: FormVariables = {}) =>
  evaluateGroup(q.showIf, answers, vars)

/** Preguntas que ocupan una pantalla: todas menos los campos ocultos (que llegan por la URL). */
export const screenQuestions = (config: FormConfig): Question[] => config.questions.filter((q) => q.type !== 'hidden')

function resolveTarget(config: FormConfig, target: string): Step | null {
  if (config.endings.some((e) => e.id === target)) return { kind: 'ending', id: target }
  if (screenQuestions(config).some((q) => q.id === target)) return { kind: 'question', id: target }
  return null
}

/**
 * Siguiente paso al salir de `currentId` (o el primero si es null). Los saltos solo se siguen si
 * apuntan hacia delante o a un final: un salto hacia atrás sería un bucle infinito para quien
 * rellena el formulario.
 */
export function nextStep(
  config: FormConfig,
  currentId: string | null,
  answers: Answers,
  vars: FormVariables = {}
): Step {
  const screens = screenQuestions(config)
  const indexOf = (id: string) => screens.findIndex((q) => q.id === id)
  const currentIdx = currentId === null ? -1 : indexOf(currentId)

  const firstVisibleFrom = (start: number): Step => {
    for (let i = start; i < screens.length; i++) {
      if (isQuestionVisible(screens[i], answers, vars)) return { kind: 'question', id: screens[i].id }
    }
    return { kind: 'ending', id: resolveEnding(config, answers, vars)?.id ?? null }
  }

  if (currentId !== null) {
    for (const rule of config.logic) {
      if (rule.from !== currentId || !evaluateGroup(rule.when, answers, vars)) continue
      const action = rule.then
      if (action.type === 'end') {
        return { kind: 'ending', id: config.endings.some((e) => e.id === action.endingId) ? action.endingId : null }
      }
      const target = resolveTarget(config, action.target)
      if (!target) continue
      if (target.kind === 'ending') return target
      const targetIdx = indexOf(target.id)
      if (targetIdx > currentIdx) return firstVisibleFrom(targetIdx)
    }
  }
  return firstVisibleFrom(currentIdx + 1)
}

/** El camino completo que recorrería esa persona con esas respuestas. */
export function walkPath(
  config: FormConfig,
  answers: Answers,
  vars: FormVariables = {}
): { questionIds: string[]; endingId: string | null } {
  const questionIds: string[] = []
  const seen = new Set<string>()
  let step = nextStep(config, null, answers, vars)
  while (step.kind === 'question' && !seen.has(step.id)) {
    seen.add(step.id)
    questionIds.push(step.id)
    step = nextStep(config, step.id, answers, vars)
  }
  return { questionIds, endingId: step.kind === 'ending' ? step.id : null }
}

/**
 * Las respuestas que valen: solo las del camino real, más los campos ocultos (siempre válidos, no
 * dependen de rama). Es lo que se valida, puntúa, guarda y envía.
 */
export function getPathAnswers(config: FormConfig, answers: Answers, vars: FormVariables = {}): Answers {
  const { questionIds } = walkPath(config, answers, vars)
  const out: Answers = {}
  for (const id of questionIds) {
    const v = answers[id]
    if (!isEmptyValue(v)) out[id] = v
  }
  for (const q of config.questions) {
    if (q.type === 'hidden') {
      const v = answers[q.id]
      if (!isEmptyValue(v)) out[q.id] = v
    }
  }
  return out
}

/** Primer final cuyo `when` se cumple; si ninguno, el marcado por defecto o el primero sin condición. */
export function resolveEnding(config: FormConfig, answers: Answers, vars: FormVariables = {}): Ending | null {
  const conditional = config.endings.find(
    (e) => e.when && e.when.conditions.length > 0 && evaluateGroup(e.when, answers, vars)
  )
  if (conditional) return conditional
  return (
    config.endings.find((e) => e.isDefault) ??
    config.endings.find((e) => !e.when || e.when.conditions.length === 0) ??
    null
  )
}

function answerLabel(q: Question | undefined, v: Answer | undefined): string {
  if (isEmptyValue(v)) return ''
  const label = (value: string) => q?.options?.find((o) => o.value === value)?.label ?? value
  return Array.isArray(v) ? v.map((x) => label(String(x))).join(', ') : label(String(v))
}

/**
 * Sustituye `{{id}}` (respuesta, con su etiqueta si es una opción) y `{{variable}}`. Lo
 * desconocido queda vacío: un `{{x}}` visible en pantalla delata un formulario roto.
 */
export function pipe(text: string, config: FormConfig, answers: Answers, vars: FormVariables = {}): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_.$-]+)\s*\}\}/g, (_m, key: string) => {
    if (key in vars) return String(vars[key] ?? '')
    return answerLabel(
      config.questions.find((q) => q.id === key),
      answers[key]
    )
  })
}

/** Igual que `pipe` pero para URLs: cada valor interpolado se codifica. */
export function pipeUrl(url: string, config: FormConfig, answers: Answers, vars: FormVariables = {}): string {
  return url.replace(/\{\{\s*([a-zA-Z0-9_.$-]+)\s*\}\}/g, (_m, key: string) => {
    const raw =
      key in vars
        ? String(vars[key] ?? '')
        : answerLabel(
            config.questions.find((q) => q.id === key),
            answers[key]
          )
    // Una variable que ya es una URL completa (p. ej. trustpilot_url) va tal cual.
    return /^https?:\/\//i.test(raw) ? raw : encodeURIComponent(raw)
  })
}

/** Solo redirecciones http(s): un `javascript:` en el final de un formulario sería XSS. */
export function safeRedirectUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}
