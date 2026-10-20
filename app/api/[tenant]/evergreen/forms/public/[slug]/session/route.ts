import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { loadPublishedForm, serviceClient } from '@/lib/forms/server'
import { ipDe, limitar } from '@/lib/security/rate-limit'

export const dynamic = 'force-dynamic'

const body = z.object({
  sessionId: z.string().uuid(),
  status: z.enum(['viewed', 'started', 'completed', 'abandoned']),
  lastQuestion: z.string().max(40).optional(),
  maxIndex: z.number().int().min(0).max(500).optional(),
  questionTimes: z.record(z.string().max(40), z.number().int().min(0).max(3_600_000)).optional(),
  variant: z.enum(['A', 'B']).optional(),
  device: z.enum(['mobile', 'desktop']).optional(),
  utm: z.record(z.string().max(40), z.string().max(200)).optional(),
  referrerHost: z.string().max(200).optional(),
})

// Analítica por sesión: el navegador manda una FOTO del estado de su sesión (una fila por sesión,
// no por evento). Idempotente y monótona: una sesión completada no retrocede.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string; slug: string }> }) {
  const { tenant, slug } = await params
  if (!limitar(`forms:ses:${ipDe(req.headers)}`, 240, 60_000).ok) return NextResponse.json({ ok: true })

  const parsed = body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Petición no válida' }, { status: 400 })
  const s = parsed.data

  const sb = serviceClient()
  const loaded = await loadPublishedForm(sb, tenant, slug)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { form } = loaded

  const { data: existing } = await sb
    .from('form_sessions')
    .select('status, max_question_index, started_at')
    .eq('tenant_id', form.tenantId)
    .eq('session_id', s.sessionId)
    .maybeSingle()
  if (existing?.status === 'completed') return NextResponse.json({ ok: true })

  const now = new Date().toISOString()
  const { error } = await sb.from('form_sessions').upsert(
    {
      tenant_id: form.tenantId,
      form_id: form.formId,
      version_id: form.versionId,
      session_id: s.sessionId,
      status: s.status,
      device: s.device ?? null,
      variant: s.variant ?? null,
      utm: s.utm ?? {},
      referrer_host: s.referrerHost ?? null,
      last_question: s.lastQuestion ?? null,
      max_question_index: Math.max(existing?.max_question_index ?? 0, s.maxIndex ?? 0),
      question_times: s.questionTimes ?? {},
      started_at: existing?.started_at ?? (s.status === 'viewed' ? null : now),
      completed_at: s.status === 'completed' ? now : null,
      last_active_at: now,
    },
    { onConflict: 'tenant_id,session_id' }
  )
  if (error) return NextResponse.json({ error: 'No se pudo registrar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
