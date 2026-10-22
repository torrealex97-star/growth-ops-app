import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { requireTenant } from '@/lib/auth/requireTenant'
import { readPaymentInbox } from '@/lib/sales/payment-inbox'
import { conAlias } from '@/lib/sales/identidad-pago'

export const runtime = 'nodejs'
export const maxDuration = 30

const schema = z.object({
  paymentId: z.string().regex(/^pi_[A-Za-z0-9]+$/),
  contactId: z.string().uuid(),
})

// VINCULAR UN COBRO A UN CONTACTO cuando la persona pagó con otro correo.
//
// Quién: solo administración (admin/director/super admin). Atribuir un cobro a una persona decide a quién
// se le comisiona (docs/MONEY.md), y el closer ni siquiera ve en su bandeja los cobros sin contacto.
//
// Qué recuerda, para que no haya que repetirlo:
//   · el CLIENTE de Stripe → contacto (`stripe_customers.contact_id`): todos sus pagos, presentes y futuros;
//   · el CORREO de pago como alternativo del contacto (`custom_fields.emails_alternativos`): si la misma
//     persona paga otra vez como cliente nuevo de Stripe con ese correo, también encaja.
// No crea ninguna venta ni cobro: eso sigue siendo el paso siguiente de la bandeja, con su confirmación.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error
  if (!session.isSuperAdmin && !['admin', 'director'].includes(session.role ?? '')) {
    return NextResponse.json({ error: 'Solo administración puede vincular un cobro a un contacto.' }, { status: 403 })
  }
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Revisa los datos.' }, { status: 400 })
  const { paymentId, contactId } = parsed.data

  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const rows = await readPaymentInbox(sb, session.tenantId, null, { soloPago: paymentId })
    const pago = rows.find((r) => r.payment_id === paymentId)
    if (!pago)
      return NextResponse.json({ error: 'El cobro ya está registrado. Actualiza la bandeja.' }, { status: 409 })

    const { data: contacto, error: errContacto } = await sb
      .from('contacts')
      .select('id,email,full_name,custom_fields,merged_into')
      .eq('tenant_id', session.tenantId)
      .eq('id', contactId)
      .maybeSingle()
    if (errContacto) throw new Error(errContacto.message)
    if (!contacto) return NextResponse.json({ error: 'Contacto no encontrado.' }, { status: 404 })
    if (contacto.merged_into) {
      return NextResponse.json(
        { error: 'Ese contacto está fusionado en otro: vincula el contacto principal.' },
        { status: 409 }
      )
    }

    // 1) El cliente de Stripe. Si la sincronización aún no lo conocía, se crea la fila mínima.
    if (pago.customer_id) {
      const { data: existente, error: errBusca } = await sb
        .from('stripe_customers')
        .select('id')
        .eq('tenant_id', session.tenantId)
        .eq('stripe_customer_id', pago.customer_id)
        .maybeSingle()
      if (errBusca) throw new Error(errBusca.message)
      const ahora = new Date().toISOString()
      const { error: errVinculo } = existente
        ? await sb.from('stripe_customers').update({ contact_id: contactId, updated_at: ahora }).eq('id', existente.id)
        : await sb.from('stripe_customers').insert({
            tenant_id: session.tenantId,
            stripe_customer_id: pago.customer_id,
            contact_id: contactId,
            email: pago.customer_email,
            name: pago.customerName,
            status: 'cliente',
            last_synced_at: ahora,
          })
      if (errVinculo) throw new Error(errVinculo.message)
    }

    // 2) El correo de pago, como alternativo del contacto.
    const campos = conAlias(contacto, pago.customer_email)
    if (campos) {
      const { error: errAlias } = await sb
        .from('contacts')
        .update({ custom_fields: campos })
        .eq('tenant_id', session.tenantId)
        .eq('id', contactId)
      if (errAlias) throw new Error(errAlias.message)
    }

    const { error: errAudit } = await sb.from('audit_logs').insert({
      tenant_id: session.tenantId,
      actor_user_id: session.userId,
      entity_type: 'contact',
      entity_id: contactId,
      action: 'vincular_cobro_stripe',
      old_values: null,
      // Sin el correo en claro: la acta dice QUÉ se vinculó, no datos personales del pagador.
      new_values: { payment_id: paymentId, stripe_customer: pago.customer_id ?? null, alias_recordado: !!campos },
    })
    if (errAudit) console.error('[payment-inbox/vincular] audit_logs no se pudo escribir:', errAudit.message)

    return NextResponse.json({
      ok: true,
      contactId,
      aliasRecordado: !!campos,
      clienteStripeVinculado: !!pago.customer_id,
    })
  } catch (e) {
    console.error('[payment-inbox/vincular]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudo vincular el cobro. Reintenta.' }, { status: 503 })
  }
}
