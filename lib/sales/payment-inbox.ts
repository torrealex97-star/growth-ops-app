import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows, type RangeQuery } from '@/lib/supabase/paginate'
import { emailsDeContacto, aliasDeContacto } from '@/lib/sales/identidad-pago'

export type InboxPayment = {
  customer_id?: string | null
  payment_id: string
  charge_id: string | null
  customer_email: string | null
  amount: number
  refunded_amount: number
  currency: string
  status: string
  paid_at: string | null
}
type Contact = { id: string; email: string | null; full_name: string | null; custom_fields?: unknown }
export type PendingPayment = InboxPayment & {
  contactId: string | null
  contactName: string | null
  /** `alias`: el correo de pago es un correo alternativo que se recordó en el contacto. */
  identitySource: 'customer' | 'email' | 'alias' | null
  /** Nombre del cliente en Stripe (si se conoce): ayuda a sugerir quién es cuando el correo no encaja. */
  customerName: string | null
}

/** A receipt is a task, never a sale. Ambiguous identities require an administrator. */
export function pendingPayments(
  payments: InboxPayment[],
  contacts: Contact[],
  references: Set<string>,
  allowedContacts: Set<string> | null,
  customerLinks: { stripe_customer_id: string; contact_id: string | null; name?: string | null }[] = []
): PendingPayment[] {
  const byEmail = new Map<string, Contact[]>()
  // El correo principal Y los alternativos recordados: quien paga con otro correo ya vinculado encaja solo.
  for (const c of contacts) {
    for (const email of emailsDeContacto(c)) byEmail.set(email, [...(byEmail.get(email) ?? []), c])
  }
  return payments.flatMap((p) => {
    if (!['succeeded', 'partially_refunded'].includes(p.status) || Number(p.amount) <= Number(p.refunded_amount))
      return []
    if (references.has(p.payment_id) || (p.charge_id && references.has(p.charge_id))) return []
    const matches = byEmail.get(p.customer_email?.trim().toLowerCase() ?? '') ?? []
    const linkedIds = new Set(
      customerLinks.filter((c) => c.stripe_customer_id === p.customer_id && c.contact_id).map((c) => c.contact_id)
    )
    const linked = linkedIds.size === 1 ? contacts.find((c) => linkedIds.has(c.id)) : null
    const conflict =
      linkedIds.size > 1 || matches.length > 1 || (linked && matches.length === 1 && matches[0].id !== linked.id)
    const contact = conflict ? null : (linked ?? (matches.length === 1 ? matches[0] : null))
    const porAlias =
      !!contact &&
      !linked &&
      !!p.customer_email &&
      aliasDeContacto(contact).includes(p.customer_email.trim().toLowerCase())
    const identitySource = contact
      ? linked
        ? ('customer' as const)
        : porAlias
          ? ('alias' as const)
          : ('email' as const)
      : null
    if (allowedContacts && (!contact || !allowedContacts.has(contact.id))) return []
    const customerName = customerLinks.find((c) => c.stripe_customer_id === p.customer_id)?.name ?? null
    return [
      { ...p, contactId: contact?.id ?? null, contactName: contact?.full_name ?? null, identitySource, customerName },
    ]
  })
}

export async function readPaymentInbox(sb: SupabaseClient, tenantId: string, closerId: string | null) {
  const read = async <T>(table: string, columns: string) => {
    const result = await fetchAllRows<T>(
      () => sb.from(table).select(columns).eq('tenant_id', tenantId).order('id') as unknown as RangeQuery<T>
    )
    if (result.error || result.truncated) throw new Error('No se pudo leer la bandeja completa de cobros. Reintenta.')
    return result.rows
  }
  const [payments, contacts, collections, appointments, sales, customerLinks] = await Promise.all([
    read<InboxPayment>(
      'stripe_payments',
      'payment_id,charge_id,customer_id,customer_email,amount,refunded_amount,currency,status,paid_at'
    ),
    read<Contact>('contacts', 'id,email,full_name,custom_fields'),
    read<{ payment_reference: string | null }>('collections', 'payment_reference'),
    closerId
      ? read<{ contact_id: string; closer_id: string | null }>('appointments', 'contact_id,closer_id')
      : Promise.resolve([]),
    closerId
      ? read<{ contact_id: string; closer_id: string | null }>('sales', 'contact_id,closer_id')
      : Promise.resolve([]),
    read<{ stripe_customer_id: string; contact_id: string | null; name: string | null }>(
      'stripe_customers',
      'stripe_customer_id,contact_id,name'
    ),
  ])
  const allowed = closerId
    ? new Set([...appointments, ...sales].filter((r) => r.closer_id === closerId).map((r) => r.contact_id))
    : null
  const rows = pendingPayments(
    payments,
    contacts,
    new Set(collections.flatMap((c) => (c.payment_reference ? [c.payment_reference] : []))),
    allowed,
    customerLinks
  )
  return rows.sort((a, b) => (b.paid_at ?? '').localeCompare(a.paid_at ?? ''))
}
