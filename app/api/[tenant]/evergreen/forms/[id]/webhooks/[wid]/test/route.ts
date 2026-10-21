import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenant } from '@/lib/auth/requireTenant'
import { serviceClient } from '@/lib/forms/server'
import { isSafeWebhookUrl, sendTest } from '@/lib/forms/webhooks'

export const dynamic = 'force-dynamic'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ tenant: string; id: string; wid: string }> }
) {
  const { tenant, id, wid } = await params
  if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(wid).success)
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!['admin', 'director'].includes(auth.role ?? ''))
    return NextResponse.json({ error: 'Solo administración' }, { status: 403 })
  const sb = serviceClient()
  const [{ data: w }, { data: f }] = await Promise.all([
    sb
      .from('form_webhooks')
      .select('url, secret_enc')
      .eq('tenant_id', auth.tenantId)
      .eq('form_id', id)
      .eq('id', wid)
      .maybeSingle(),
    sb.from('forms').select('id, name, slug').eq('tenant_id', auth.tenantId).eq('id', id).maybeSingle(),
  ])
  if (!w || !f) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  if (!isSafeWebhookUrl(w.url)) return NextResponse.json({ error: 'URL no permitida' }, { status: 400 })
  const r = await sendTest(w.secret_enc, w.url, f)
  return NextResponse.json({ ok: r.ok, status: r.status, error: r.error })
}
