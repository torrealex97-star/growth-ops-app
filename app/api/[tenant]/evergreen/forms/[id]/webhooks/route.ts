import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { encryptSecret } from '@/lib/config'
import { requireTenant } from '@/lib/auth/requireTenant'
import { serviceClient } from '@/lib/forms/server'
import { isSafeWebhookUrl, newWebhookSecret } from '@/lib/forms/webhooks'

export const dynamic = 'force-dynamic'
const uuid = z.string().uuid()
const ADMIN = ['admin', 'director']

async function guard(tenant: string, id: string) {
  if (!uuid.safeParse(id).success) return { error: NextResponse.json({ error: 'No encontrado' }, { status: 404 }) }
  const auth = await requireTenant(tenant)
  if ('error' in auth) return { error: auth.error }
  if (!ADMIN.includes(auth.role ?? ''))
    return { error: NextResponse.json({ error: 'Solo administración gestiona webhooks' }, { status: 403 }) }
  return { auth, sb: serviceClient() }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const g = await guard(tenant, id)
  if ('error' in g) return g.error
  const { auth, sb } = g
  const { data: hooks } = await sb
    .from('form_webhooks')
    .select('id, url, active, created_at')
    .eq('tenant_id', auth.tenantId)
    .eq('form_id', id)
    .order('created_at')
  const out = await Promise.all(
    (hooks ?? []).map(async (h) => {
      const count = (status: string) =>
        sb
          .from('form_webhook_deliveries')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', auth.tenantId)
          .eq('webhook_id', h.id)
          .eq('status', status)
      const [ok, pending, failed, last] = await Promise.all([
        count('delivered'),
        count('pending'),
        count('failed'),
        sb
          .from('form_webhook_deliveries')
          .select('last_status_code, last_error, created_at')
          .eq('tenant_id', auth.tenantId)
          .eq('webhook_id', h.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      return {
        ...h,
        delivered: ok.count ?? 0,
        pending: pending.count ?? 0,
        failed: failed.count ?? 0,
        last: last.data ?? null,
      }
    })
  )
  return NextResponse.json({ webhooks: out })
}

const post = z.object({ url: z.string().url().max(2000) })

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const g = await guard(tenant, id)
  if ('error' in g) return g.error
  const { auth, sb } = g
  const b = post.safeParse(await req.json().catch(() => null))
  if (!b.success || !isSafeWebhookUrl(b.data.url))
    return NextResponse.json({ error: 'La URL debe ser https y pública' }, { status: 400 })
  const { count } = await sb
    .from('form_webhooks')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', auth.tenantId)
    .eq('form_id', id)
  if ((count ?? 0) >= 5) return NextResponse.json({ error: 'Máximo 5 webhooks por formulario' }, { status: 400 })
  const secret = newWebhookSecret()
  const { data, error } = await sb
    .from('form_webhooks')
    .insert({ tenant_id: auth.tenantId, form_id: id, url: b.data.url, secret_enc: encryptSecret(secret) })
    .select('id')
    .single()
  if (error || !data) return NextResponse.json({ error: 'No se pudo crear el webhook' }, { status: 500 })
  // El secreto se muestra UNA vez: después solo se guarda cifrado.
  return NextResponse.json({ id: data.id, secret })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const g = await guard(tenant, id)
  if ('error' in g) return g.error
  const wid = req.nextUrl.searchParams.get('wid') ?? ''
  if (!uuid.safeParse(wid).success) return NextResponse.json({ error: 'Falta wid' }, { status: 400 })
  const { error } = await g.sb
    .from('form_webhooks')
    .delete()
    .eq('tenant_id', g.auth.tenantId)
    .eq('form_id', id)
    .eq('id', wid)
  if (error) return NextResponse.json({ error: 'No se pudo eliminar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
