// Feedback de alumnos: resumen de valoraciones, NPS y dashboard de profesores. Pura (sin BD).

export interface FeedbackRow {
  form_id: string
  rating: number | null
  nps: number | null
  teacher: string | null
  module: string | null
  class_name: string | null
  created_at: string
  contact_id: string | null
  /** Comentario de texto libre ya extraído (solo se guarda en valoraciones bajas). */
  comment?: string | null
}

export interface Group {
  label: string
  responses: number
  average: number | null
  low: number
  /** Media de las 4 últimas semanas completas vs. las 4 anteriores (null si no hay datos). */
  trend: number | null
  /** NPS (-100..100) SOLO de las respuestas de este profesor/módulo/clase; null si no hay respuestas NPS. */
  npsScore: number | null
  npsResponses: number
}

/** NPS clásico: (promotores − detractores) / respuestas × 100. */
export function npsScoreOf(values: number[]): number | null {
  if (!values.length) return null
  const promoters = values.filter((n) => n >= 9).length
  const detractors = values.filter((n) => n <= 6).length
  return Math.round(((promoters - detractors) / values.length) * 100)
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const WEEK = 7 * 86_400_000

/** Una valoración baja es < 4 estrellas: lo que los formularios enrutan a "mejora". */
export const LOW_RATING = 4

function group(rows: FeedbackRow[], key: (r: FeedbackRow) => string | null, now: number): Group[] {
  const by = new Map<string, FeedbackRow[]>()
  for (const r of rows) {
    const k = key(r)
    // Cada grupo (profesor/módulo/clase) agrupa las estrellas Y el NPS de SUS respuestas: el dato no se
    // mezcla con el de otras clases ni se guarda en la ficha del alumno.
    if (!k || (r.rating === null && r.nps === null)) continue
    by.set(k, [...(by.get(k) ?? []), r])
  }
  return [...by.entries()]
    .map(([label, rs]) => {
      const rated = rs.filter((r) => r.rating !== null)
      const ratings = rated.map((r) => r.rating as number)
      const npsValues = rs.map((r) => r.nps).filter((x): x is number => x !== null)
      const recent = rated.filter((r) => now - Date.parse(r.created_at) < 4 * WEEK).map((r) => r.rating as number)
      const prev = rated
        .filter((r) => {
          const age = now - Date.parse(r.created_at)
          return age >= 4 * WEEK && age < 8 * WEEK
        })
        .map((r) => r.rating as number)
      const a = avg(recent),
        b = avg(prev)
      return {
        label,
        responses: ratings.length,
        average: avg(ratings),
        low: ratings.filter((n) => n < LOW_RATING).length,
        trend: a !== null && b !== null ? a - b : null,
        npsScore: npsScoreOf(npsValues),
        npsResponses: npsValues.length,
      }
    })
    .sort((x, y) => y.responses - x.responses)
}

export interface FeedbackSummary {
  responses: number
  linked: number
  rating: { average: number | null; responses: number; distribution: Record<string, number> }
  nps: { score: number | null; responses: number; promoters: number; passives: number; detractors: number }
  teachers: Group[]
  modules: Group[]
  classes: Group[]
  lowComments: {
    teacher: string | null
    module: string | null
    class: string | null
    rating: number
    comment: string
    at: string
  }[]
  weekly: { week: string; average: number | null; responses: number }[]
}

export function computeFeedback(rows: FeedbackRow[], now = Date.now()): FeedbackSummary {
  const ratings = rows.map((r) => r.rating).filter((x): x is number => x !== null)
  const dist: Record<string, number> = {}
  for (const n of ratings) dist[String(n)] = (dist[String(n)] ?? 0) + 1
  const npsVals = rows.map((r) => r.nps).filter((x): x is number => x !== null)
  const promoters = npsVals.filter((n) => n >= 9).length
  const detractors = npsVals.filter((n) => n <= 6).length

  const weeks = new Map<string, number[]>()
  for (const r of rows) {
    if (r.rating === null) continue
    const d = new Date(r.created_at)
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    const k = d.toISOString().slice(0, 10)
    weeks.set(k, [...(weeks.get(k) ?? []), r.rating])
  }

  return {
    responses: rows.length,
    linked: rows.filter((r) => r.contact_id).length,
    rating: { average: avg(ratings), responses: ratings.length, distribution: dist },
    nps: {
      score: npsScoreOf(npsVals),
      responses: npsVals.length,
      promoters,
      passives: npsVals.length - promoters - detractors,
      detractors,
    },
    teachers: group(rows, (r) => r.teacher, now),
    modules: group(rows, (r) => r.module, now),
    classes: group(rows, (r) => r.class_name, now),
    lowComments: rows
      .filter((r) => r.rating !== null && r.rating < LOW_RATING && r.comment)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 30)
      .map((r) => ({
        teacher: r.teacher,
        module: r.module,
        class: r.class_name,
        rating: r.rating as number,
        comment: r.comment as string,
        at: r.created_at,
      })),
    weekly: [...weeks.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([week, xs]) => ({ week, average: avg(xs), responses: xs.length })),
  }
}
