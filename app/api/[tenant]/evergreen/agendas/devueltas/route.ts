import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { contactosDevueltos } from '@/lib/appointments/devueltas'

export const runtime = 'nodejs'

const MAX_IDS = 400

// Devuelve cuáles de los contactos PEDIDOS tienen un pago devuelto. Por qué POST con ids: el cliente
// solo pregunta por los contactos de las agendas que ya puede ver (RLS/scope de colaboradora), así
// que la respuesta no revela nada de contactos ajenos ni importes: es una marca, no un dato de dinero.
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  const body = (await req.json().catch(() => null)) as { contactIds?: unknown } | null
  const ids = Array.isArray(body?.contactIds)
    ? [...new Set(body.contactIds.filter((x): x is string => typeof x === 'string'))].slice(0, MAX_IDS)
    : []
  if (ids.length === 0) return NextResponse.json({ devueltos: [] })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const [contactosRes, ventasRes] = await Promise.all([
    sb.from('contacts').select('id, email').eq('tenant_id', auth.tenantId).in('id', ids),
    sb
      .from('sales')
      .select('contact_id, status')
      .eq('tenant_id', auth.tenantId)
      .eq('status', 'refunded')
      .in('contact_id', ids),
  ])
  if (contactosRes.error || ventasRes.error) {
    return NextResponse.json({ error: 'No se pudo comprobar las devoluciones' }, { status: 500 })
  }
  const contactos = (contactosRes.data ?? []) as { id: string; email: string | null }[]
  const emails = contactos.map((c) => c.email?.trim().toLowerCase()).filter((e): e is string => !!e)
  let pagos: { customer_email: string | null; status: string | null }[] = []
  if (emails.length > 0) {
    const pagosRes = await sb
      .from('stripe_payments')
      .select('customer_email, status')
      .eq('tenant_id', auth.tenantId)
      .eq('status', 'refunded')
      .in('customer_email', emails)
    if (pagosRes.error) return NextResponse.json({ error: 'No se pudo comprobar las devoluciones' }, { status: 500 })
    pagos = (pagosRes.data ?? []) as typeof pagos
  }
  const devueltos = contactosDevueltos(
    contactos,
    pagos,
    (ventasRes.data ?? []) as { contact_id: string | null; status: string | null }[]
  )
  return NextResponse.json({ devueltos: [...devueltos] })
}
