// Analítica de un formulario, calculada a partir de sesiones (una fila por sesión) y respuestas.
// Pura y sin BD: la ruta de API le pasa filas ya acotadas por tenant/formulario/ventana.
//
// Corrige los fallos de la analítica del MVP: las visitas SÍ se cuentan (cada sesión es una fila,
// aunque no empiece), el embudo se calcula por ID de pregunta (no por posición, que se rompía al
// reordenar o ramificar) y cambiar de pestaña no cuenta como abandono.

import type { Answer, FormConfig } from './types'

export interface SessionRow {
  status: 'viewed' | 'started' | 'completed' | 'abandoned'
  device: 'mobile' | 'desktop' | null
  variant: 'A' | 'B' | null
  utm: Record<string, string> | null
  referrer_host: string | null
  last_question: string | null
  max_question_index: number
  question_times: Record<string, number> | null
  created_at: string
  started_at: string | null
  completed_at: string | null
}

export interface ResponseRow {
  status: 'partial' | 'completed'
  answers: Record<string, Answer>
  rating: number | null
  nps: number | null
  score: number | null
  temperature: 'caliente' | 'templado' | 'frio' | null
  outcome: string | null
  variant: 'A' | 'B' | null
  device: 'mobile' | 'desktop' | null
  duration_ms: number | null
  created_at: string
  completed_at: string | null
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1
}
const day = (iso: string) => iso.slice(0, 10)

export interface QuestionSummary {
  id: string
  title: string
  type: string
  answered: number
  /** Elecciones (opción única/múltiple, Sí/No, desplegable): recuento por etiqueta. */
  choices?: { label: string; count: number }[]
  /** Valoración / escala: media y distribución. */
  rating?: { average: number | null; distribution: Record<string, number> }
  /** NPS clásico: promotores (9-10) − detractores (0-6). */
  nps?: { score: number | null; promoters: number; passives: number; detractors: number }
  /** Texto libre: las últimas respuestas (acotadas). */
  texts?: string[]
}

export interface Analytics {
  kpis: {
    views: number
    starts: number
    completions: number
    abandonments: number
    startRate: number | null
    completionRate: number | null
    completionRateOfStarts: number | null
    avgCompletionMs: number | null
    medianCompletionMs: number | null
  }
  /** Visitas → empiezan (abandono antes de la primera pregunta). */
  entry: { views: number; starts: number; dropped: number; dropRate: number | null }
  /**
   * Embudo por paso, por ID de pregunta (correcto con saltos y ramas):
   * `reached` = sesiones que llegaron a esa pregunta; `dropped` = las que se fueron SIN terminar estando
   * en ella; `dropRate` = dropped / reached (tasa de abandono del paso); `pctOfStarts` = reached / empiezan.
   */
  funnel: {
    id: string
    title: string
    reached: number
    dropped: number
    dropRate: number | null
    pctOfStarts: number | null
  }[]
  biggestDrop: { id: string; title: string; dropped: number; dropRate: number } | null
  timePerQuestion: { id: string; title: string; avgMs: number }[]
  devices: Record<string, number>
  sources: { label: string; count: number }[]
  campaigns: { label: string; count: number }[]
  variants: { variant: 'A' | 'B'; views: number; completions: number; rate: number | null }[]
  daily: { day: string; views: number; completions: number }[]
  score: { average: number | null; temperatures: Record<string, number>; buckets: Record<string, number> }
  outcomes: { id: string; count: number }[]
  questions: QuestionSummary[]
  nps: { score: number | null; responses: number } | null
  rating: { average: number | null; responses: number } | null
}

export function computeAnalytics(config: FormConfig, sessions: SessionRow[], responses: ResponseRow[]): Analytics {
  const completed = responses.filter((r) => r.status === 'completed')
  const views = sessions.length
  const started = sessions.filter((s) => s.status !== 'viewed')
  const abandoned = sessions.filter((s) => s.status === 'abandoned')
  // Un envío completado cuenta aunque su sesión no llegase a registrarse (bloqueadores, embeds).
  const completions = Math.max(sessions.filter((s) => s.status === 'completed').length, completed.length)
  const starts = Math.max(started.length, completions)

  const durations = completed.map((r) => r.duration_ms).filter((d): d is number => typeof d === 'number' && d > 0)
  const screens = config.questions.filter((q) => q.type !== 'hidden')
  const titleOf = (id: string) => screens.find((q) => q.id === id)?.title || id

  // Embudo por ID de pregunta. Una sesión "llegó" a una pregunta si la visitó (tiene tiempo registrado
  // en ella o es la última en la que estuvo). Abandona en un paso si NO completó y su última pregunta
  // es ese paso. Con saltos y ramas la posición en el camino no coincide con el orden de la config, así
  // que el índice (como hacía el MVP) daría un embudo falso.
  const startedSessions = sessions.filter((s) => s.status !== 'viewed')
  const visited = (s: SessionRow) =>
    new Set([...Object.keys(s.question_times ?? {}), ...(s.last_question ? [s.last_question] : [])])
  const visitedBy = startedSessions.map((s) => ({ s, v: visited(s) }))
  const funnel = screens
    .filter((q) => q.type !== 'statement')
    .map((q) => {
      const reachedList = visitedBy.filter((x) => x.v.has(q.id))
      const reached = reachedList.length
      const dropped = reachedList.filter((x) => x.s.status !== 'completed' && x.s.last_question === q.id).length
      return {
        id: q.id,
        title: titleOf(q.id),
        reached,
        dropped,
        dropRate: reached ? dropped / reached : null,
        pctOfStarts: starts ? reached / starts : null,
      }
    })
  let biggest: Analytics['biggestDrop'] = null
  for (const f of funnel) {
    if (f.dropRate !== null && f.dropped > 0 && f.dropped > (biggest?.dropped ?? 0)) {
      biggest = { id: f.id, title: f.title, dropped: f.dropped, dropRate: f.dropRate }
    }
  }
  const entryDropped = Math.max(views - starts, 0)
  const entry = { views, starts, dropped: entryDropped, dropRate: views ? entryDropped / views : null }

  const times: Record<string, number[]> = {}
  for (const s of sessions) for (const [id, ms] of Object.entries(s.question_times ?? {})) (times[id] ??= []).push(ms)
  const timePerQuestion = Object.entries(times)
    .map(([id, xs]) => ({ id, title: titleOf(id), avgMs: Math.round(avg(xs) ?? 0) }))
    .sort((a, b) => b.avgMs - a.avgMs)

  const devices: Record<string, number> = {}
  const sourceCount: Record<string, number> = {}
  const campaignCount: Record<string, number> = {}
  for (const s of sessions) {
    bump(devices, s.device ?? 'desconocido')
    bump(sourceCount, s.utm?.source || s.referrer_host || 'directo')
    if (s.utm?.campaign) bump(campaignCount, s.utm.campaign)
  }
  const top = (m: Record<string, number>, n = 8) =>
    Object.entries(m)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, n)

  const variants = (['A', 'B'] as const)
    .map((v) => {
      const vs = sessions.filter((s) => s.variant === v)
      const done = Math.max(
        vs.filter((s) => s.status === 'completed').length,
        completed.filter((r) => r.variant === v).length
      )
      return { variant: v, views: vs.length, completions: done, rate: vs.length ? done / vs.length : null }
    })
    .filter((v) => v.views > 0)

  const dailyMap: Record<string, { views: number; completions: number }> = {}
  for (const s of sessions) (dailyMap[day(s.created_at)] ??= { views: 0, completions: 0 }).views++
  for (const r of completed)
    (dailyMap[day(r.completed_at ?? r.created_at)] ??= { views: 0, completions: 0 }).completions++
  const daily = Object.entries(dailyMap)
    .map(([d, v]) => ({ day: d, ...v }))
    .sort((a, b) => a.day.localeCompare(b.day))

  const scores = completed.map((r) => r.score).filter((x): x is number => typeof x === 'number')
  const temperatures: Record<string, number> = {}
  const buckets: Record<string, number> = {}
  for (const r of completed) if (r.temperature) bump(temperatures, r.temperature)
  for (const sc of scores)
    bump(buckets, `${Math.min(Math.floor(sc / 20), 4) * 20}-${Math.min(Math.floor(sc / 20), 4) * 20 + 20}`)

  const outcomeCount: Record<string, number> = {}
  for (const r of completed) if (r.outcome) bump(outcomeCount, r.outcome)

  const questions: QuestionSummary[] = screens
    .filter((q) => q.type !== 'statement' && q.type !== 'booking')
    .map((q) => {
      const vals = completed.map((r) => r.answers?.[q.id]).filter((v): v is Answer => v !== undefined && v !== '')
      const base: QuestionSummary = { id: q.id, title: q.title || q.id, type: q.type, answered: vals.length }
      const labelOf = (v: string) =>
        q.type === 'yesNo'
          ? v === 'yes'
            ? 'Sí'
            : 'No'
          : v.startsWith('other:')
            ? `Otro: ${v.slice(6).trim()}`
            : (q.options?.find((o) => o.value === v)?.label ?? v)
      if (['singleChoice', 'multiChoice', 'dropdown', 'yesNo'].includes(q.type)) {
        const c: Record<string, number> = {}
        for (const v of vals) for (const x of Array.isArray(v) ? v : [v]) bump(c, labelOf(String(x)))
        base.choices = top(c, 12)
      } else if (q.type === 'rating' || q.type === 'scale') {
        const nums = vals.map(Number).filter(Number.isFinite)
        const dist: Record<string, number> = {}
        for (const n of nums) bump(dist, String(n))
        base.rating = { average: avg(nums), distribution: dist }
      } else if (q.type === 'nps') {
        const nums = vals.map(Number).filter(Number.isFinite)
        const promoters = nums.filter((n) => n >= 9).length
        const detractors = nums.filter((n) => n <= 6).length
        base.nps = {
          score: nums.length ? Math.round(((promoters - detractors) / nums.length) * 100) : null,
          promoters,
          passives: nums.length - promoters - detractors,
          detractors,
        }
      } else if (['shortText', 'longText', 'url', 'email'].includes(q.type) && q.type !== 'email') {
        base.texts = vals.map(String).slice(0, 15)
      }
      return base
    })

  const npsVals = completed.map((r) => r.nps).filter((x): x is number => typeof x === 'number')
  const ratingVals = completed.map((r) => r.rating).filter((x): x is number => typeof x === 'number')

  return {
    kpis: {
      views,
      starts,
      completions,
      abandonments: abandoned.length,
      startRate: views ? starts / views : null,
      completionRate: views ? completions / views : null,
      completionRateOfStarts: starts ? completions / starts : null,
      avgCompletionMs: avg(durations) === null ? null : Math.round(avg(durations)!),
      medianCompletionMs: median(durations),
    },
    entry,
    funnel,
    biggestDrop: biggest,
    timePerQuestion,
    devices,
    sources: top(sourceCount),
    campaigns: top(campaignCount),
    variants,
    daily,
    score: { average: avg(scores), temperatures, buckets },
    outcomes: Object.entries(outcomeCount)
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count),
    questions,
    nps: npsVals.length
      ? {
          score: Math.round(
            ((npsVals.filter((n) => n >= 9).length - npsVals.filter((n) => n <= 6).length) / npsVals.length) * 100
          ),
          responses: npsVals.length,
        }
      : null,
    rating: ratingVals.length ? { average: avg(ratingVals), responses: ratingVals.length } : null,
  }
}
