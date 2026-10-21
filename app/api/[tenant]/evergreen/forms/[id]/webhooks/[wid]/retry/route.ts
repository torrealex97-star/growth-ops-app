import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenant } from '@/lib/auth/requireTenant'
import { serviceClient } from '@/lib/forms/server'

export const dynamic = 'force-dynamic'

// "Reintentar ahora": reabre las entregas fallidas de este webhook para que el próximo barrido
// (cron diario) las recoja, y las deja pendientes con intentos a cero.
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
  const { data: w } = await sb
    .from('form_webhooks')
    .select('id')
    .eq('tenant_id', auth.tenantId)
    .eq('form_id', id)
    .eq('id', wid)
    .maybeSingle()
  if (!w) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  const { data, error } = await sb
    .from('form_webhook_deliveries')
    .update({ status: 'pending', attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null })
    .eq('tenant_id', auth.tenantId)
    .eq('webhook_id', wid)
    .eq('status', 'failed')
    .select('id')
  if (error) return NextResponse.json({ error: 'No se pudo reintentar' }, { status: 500 })
  return NextResponse.json({ ok: true, requeued: data?.length ?? 0 })
}
