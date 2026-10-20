import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeForms, denyIfNotVisible } from '@/lib/forms/admin'
import { computeAnalytics, type ResponseRow, type SessionRow } from '@/lib/forms/analytics'
import { formConfigSchema } from '@/lib/forms/schema'

export const dynamic = 'force-dynamic'

// Ventana y topes: la analítica se calcula sobre como mucho las últimas 5.000 sesiones y 2.000
// respuestas del periodo, con solo las columnas necesarias (egress en Supabase Free).
const MAX_SESSIONS = 5000
const MAX_RESPONSES = 2000
const query = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  device: z.enum(['mobile', 'desktop']).optional(),
  variant: z.enum(['A', 'B']).optional(),
})

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  const g = await authorizeForms(tenant, false)
  if ('error' in g) return g.error
  const { auth, sb } = g
  const denied = await denyIfNotVisible(sb, auth.tenantId, auth.role, id)
  if (denied) return denied
  const q = query.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!q.success) return NextResponse.json({ error: 'Filtros no válidos' }, { status: 400 })
  const since = new Date(Date.now() - q.data.days * 86_400_000).toISOString()

  const { data: form } = await sb
    .from('forms')
    .select('id, draft_config, published_version_id')
    .eq('tenant_id', auth.tenantId)
    .eq('id', id)
    .maybeSingle()
  if (!form) return NextResponse.json({ error: 'Formulario no encontrado' }, { status: 404 })
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
  if (!cfg.success) return NextResponse.json({ error: 'Configuración no válida' }, { status: 422 })

  let sq = sb
    .from('form_sessions')
    .select(
      'status, device, variant, utm, referrer_host, last_question, max_question_index, question_times, created_at, started_at, completed_at'
    )
    .eq('tenant_id', auth.tenantId)
    .eq('form_id', id)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_SESSIONS)
  let rq = sb
    .from('form_responses')
    .select(
      'status, answers, rating, nps, score, temperature, outcome, variant, device, duration_ms, created_at, completed_at'
    )
    .eq('tenant_id', auth.tenantId)
    .eq('form_id', id)
    .eq('status', 'completed')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(MAX_RESPONSES)
  if (q.data.device) {
    sq = sq.eq('device', q.data.device)
    rq = rq.eq('device', q.data.device)
  }
  if (q.data.variant) {
    sq = sq.eq('variant', q.data.variant)
    rq = rq.eq('variant', q.data.variant)
  }
  const [s, r] = await Promise.all([sq, rq])
  if (s.error || r.error) return NextResponse.json({ error: 'No se pudo calcular la analítica' }, { status: 500 })

  const analytics = computeAnalytics(cfg.data as never, (s.data ?? []) as SessionRow[], (r.data ?? []) as ResponseRow[])
  return NextResponse.json({
    analytics,
    days: q.data.days,
    truncated: (s.data?.length ?? 0) >= MAX_SESSIONS || (r.data?.length ?? 0) >= MAX_RESPONSES,
  })
}
