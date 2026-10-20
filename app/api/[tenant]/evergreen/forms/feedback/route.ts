import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeForms } from '@/lib/forms/admin'
import { computeFeedback, type FeedbackRow } from '@/lib/forms/feedback'
import { formConfigSchema } from '@/lib/forms/schema'

export const dynamic = 'force-dynamic'

const MAX_ROWS = 5000
const query = z.object({
  days: z.coerce.number().int().min(7).max(365).default(90),
  form: z.string().uuid().optional(),
})

// Feedback de alumnos agregado de TODOS los formularios de audiencia "alumnos" (clases en directo,
// módulos, NPS): estrellas, NPS, ranking y tendencia por profesor/módulo/clase y los comentarios de
// las valoraciones bajas. Lo ven admin, director, manager, marketing y csm.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const g = await authorizeForms(tenant, false)
  if ('error' in g) return g.error
  const { auth, sb } = g
  const q = query.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!q.success) return NextResponse.json({ error: 'Filtros no válidos' }, { status: 400 })
  const since = new Date(Date.now() - q.data.days * 86_400_000).toISOString()

  let fq = sb
    .from('forms')
    .select('id, name, category, status, published_version_id')
    .eq('tenant_id', auth.tenantId)
    .eq('audience', 'alumnos')
    .neq('status', 'archived')
    .limit(100)
  if (q.data.form) fq = fq.eq('id', q.data.form)
  const { data: forms } = await fq
  if (!forms?.length) return NextResponse.json({ forms: [], summary: computeFeedback([]), days: q.data.days })

  const formIds = forms.map((f) => f.id)
  const versionIds = forms.map((f) => f.published_version_id).filter(Boolean) as string[]
  const [{ data: rows, error }, { data: versions }] = await Promise.all([
    sb
      .from('form_responses')
      .select('form_id, rating, nps, teacher, module, class_name, created_at, contact_id, answers')
      .eq('tenant_id', auth.tenantId)
      .eq('status', 'completed')
      .in('form_id', formIds)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS),
    sb.from('form_versions').select('form_id, config').eq('tenant_id', auth.tenantId).in('id', versionIds),
  ])
  if (error) return NextResponse.json({ error: 'No se pudo cargar el feedback' }, { status: 500 })

  // Comentario libre = la respuesta de la primera pregunta de texto largo de cada formulario.
  const commentKey = new Map<string, string>()
  for (const v of versions ?? []) {
    const cfg = formConfigSchema.safeParse(v.config)
    const lt = cfg.success ? cfg.data.questions.find((x) => x.type === 'longText') : undefined
    if (lt) commentKey.set(v.form_id, lt.id)
  }
  const feedbackRows: FeedbackRow[] = (rows ?? []).map((r) => {
    const key = commentKey.get(r.form_id)
    const c = key ? (r.answers as Record<string, unknown>)?.[key] : undefined
    return {
      form_id: r.form_id,
      rating: r.rating,
      nps: r.nps,
      teacher: r.teacher,
      module: r.module,
      class_name: r.class_name,
      created_at: r.created_at,
      contact_id: r.contact_id,
      comment: typeof c === 'string' ? c.slice(0, 600) : null,
    }
  })

  const perForm = forms.map((f) => {
    const mine = feedbackRows.filter((r) => r.form_id === f.id)
    const s = computeFeedback(mine)
    return {
      id: f.id,
      name: f.name,
      category: f.category,
      status: f.status,
      responses: s.responses,
      average: s.rating.average,
      nps: s.nps.score,
    }
  })
  return NextResponse.json({
    forms: perForm,
    summary: computeFeedback(feedbackRows),
    days: q.data.days,
    truncated: (rows?.length ?? 0) >= MAX_ROWS,
  })
}
