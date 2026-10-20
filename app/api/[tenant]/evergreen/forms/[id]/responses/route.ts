import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeForms, denyIfNotVisible } from '@/lib/forms/admin'
import { toCsv } from '@/lib/forms/csv'
import { formConfigSchema } from '@/lib/forms/schema'

export const dynamic = 'force-dynamic'

const COLS =
  'id, status, answers, hidden, score, temperature, tags, rating, nps, teacher, module, class_name, outcome, variant, contact_id, review_status, review_notes, device, duration_ms, created_at, completed_at, version_id'
const PAGE = 50
const EXPORT_MAX = 5000

const query = z.object({
  page: z.coerce.number().int().min(0).max(10_000).default(0),
  status: z.enum(['completed', 'partial']).optional(),
  temperature: z.enum(['caliente', 'templado', 'frio']).optional(),
  review: z.enum(['nuevo', 'contactado', 'entrevista', 'descartado', 'contratado']).optional(),
  teacher: z.string().max(120).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  format: z.enum(['json', 'csv']).default('json'),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  const g = await authorizeForms(tenant, false)
  if ('error' in g) return g.error
  const { auth, sb } = g

  const denied = await denyIfNotVisible(sb, auth.tenantId, auth.role, id)
  if (denied) return denied
  const parsed = query.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ error: 'Filtros no válidos' }, { status: 400 })
  const q = parsed.data

  const { data: form } = await sb
    .from('forms')
    .select('id, name, draft_config, published_version_id')
    .eq('tenant_id', auth.tenantId)
    .eq('id', id)
    .maybeSingle()
  if (!form) return NextResponse.json({ error: 'Formulario no encontrado' }, { status: 404 })

  // Las etiquetas de las preguntas salen de la versión publicada (las respuestas son de ella).
  let cfgRaw: unknown = form.draft_config
  if (form.published_version_id) {
    const { data: v } = await sb
      .from('form_versions')
      .select('config')
      .eq('tenant_id', auth.tenantId)
      .eq('id', form.published_version_id)
      .maybeSingle()
    if (v) cfgRaw = v.config
  }
  const cfg = formConfigSchema.safeParse(cfgRaw)
  const questions = cfg.success ? cfg.data.questions.filter((x) => x.type !== 'hidden' && x.type !== 'statement') : []

  let qb = sb
    .from('form_responses')
    .select(COLS, { count: 'exact' })
    .eq('tenant_id', auth.tenantId)
    .eq('form_id', id)
    .order('created_at', { ascending: false })
  if (q.status) qb = qb.eq('status', q.status)
  if (q.temperature) qb = qb.eq('temperature', q.temperature)
  if (q.review) qb = qb.eq('review_status', q.review)
  if (q.teacher) qb = qb.eq('teacher', q.teacher)
  if (q.from) qb = qb.gte('created_at', `${q.from}T00:00:00Z`)
  if (q.to) qb = qb.lte('created_at', `${q.to}T23:59:59Z`)

  if (q.format === 'csv') {
    const { data, error } = await qb.range(0, EXPORT_MAX - 1)
    if (error) return NextResponse.json({ error: 'No se pudo exportar' }, { status: 500 })
    const labelOf = (qq: (typeof questions)[number], v: unknown) => {
      const one = (x: unknown) =>
        typeof x === 'string'
          ? (qq.options?.find((o) => o.value === x)?.label ?? x.replace(/^other:/, ''))
          : x === 'yes'
            ? 'Sí'
            : x
      return Array.isArray(v) ? v.map(one) : one(v)
    }
    const rows: unknown[][] = [
      [
        'Fecha',
        'Estado',
        ...questions.map((x) => x.title || x.id),
        'Puntuación',
        'Temperatura',
        'Revisión',
        'Notas',
        'Variante',
        'Dispositivo',
        'Duración (s)',
      ],
      ...(data ?? []).map((r) => [
        r.created_at,
        r.status === 'completed' ? 'Completada' : 'Parcial',
        ...questions.map((x) => labelOf(x, (r.answers as Record<string, unknown>)?.[x.id])),
        r.score,
        r.temperature,
        r.review_status,
        r.review_notes,
        r.variant,
        r.device,
        r.duration_ms ? Math.round(r.duration_ms / 1000) : '',
      ]),
    ]
    return new NextResponse(toCsv(rows), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="respuestas-${id.slice(0, 8)}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const { data, count, error } = await qb.range(q.page * PAGE, q.page * PAGE + PAGE - 1)
  if (error) return NextResponse.json({ error: 'No se pudieron cargar las respuestas' }, { status: 500 })
  return NextResponse.json({
    responses: data ?? [],
    total: count ?? 0,
    pageSize: PAGE,
    questions: questions.map((x) => ({ id: x.id, title: x.title, type: x.type, options: x.options ?? null })),
    canWrite: ['admin', 'director', 'manager', 'marketing'].includes(auth.role ?? ''),
    canDelete: ['admin', 'director'].includes(auth.role ?? ''),
  })
}
