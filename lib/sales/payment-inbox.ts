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
type ContactoProyectado = Omit<Contact, 'custom_fields'> & { emails_alternativos?: unknown }
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

/**
 * `soloPago`: cuando una ruta solo necesita UN cobro (resolve, vincular, detalle de `?payment=`), se leen en la
 * base únicamente ese pago, sus referencias de cobro y su cliente de Stripe. El resultado para ese pago es el
 * mismo que con la bandeja completa: `pendingPayments` solo mira esas tres cosas del pago, más los contactos
 * (que siguen leyéndose enteros porque la ambigüedad de correo exige verlos todos).
 */
export async function readPaymentInbox(
  sb: SupabaseClient,
  tenantId: string,
  closerId: string | null,
  opciones: { soloPago?: string } = {}
) {
  // `filtrar` aplica condiciones EN LA BASE que de todos modos se aplicarían después en código
  // (pendingPayments): así no se descargan filas que se van a tirar. Los filtros son equivalentes, no nuevos.
  type Consulta = ReturnType<ReturnType<SupabaseClient['from']>['select']>
  const read = async <T>(table: string, columns: string, filtrar?: (q: Consulta) => Consulta) => {
    const result = await fetchAllRows<T>(() => {
      const base = sb.from(table).select(columns).eq('tenant_id', tenantId) as unknown as Consulta
      return (filtrar ? filtrar(base) : base).order('id') as unknown as RangeQuery<T>
    })
    if (result.error || result.truncated) throw new Error('No se pudo leer la bandeja completa de cobros. Reintenta.')
    return result.rows
  }
  const soloPago = opciones.soloPago
  // Solo los pagos que pueden estar pendientes: pendingPayments descarta el resto sin mirarlos.
  const payments = await read<InboxPayment>(
    'stripe_payments',
    'payment_id,charge_id,customer_id,customer_email,amount,refunded_amount,currency,status,paid_at',
    (q) => {
      const base = q.in('status', ['succeeded', 'partially_refunded'])
      return soloPago ? base.eq('payment_id', soloPago) : base
    }
  )
  if (soloPago && payments.length === 0) return []
  const referencias = soloPago ? [soloPago, ...payments.flatMap((p) => (p.charge_id ? [p.charge_id] : []))] : null
  const clientesDelPago = soloPago
    ? [...new Set(payments.flatMap((p) => (p.customer_id ? [p.customer_id] : [])))]
    : null
  const [contacts, collections, appointments, sales, customerLinks] = await Promise.all([
    // Del JSON `custom_fields` de cada contacto (puede ser enorme: campos de GHL) solo se lee una clave,
    // `emails_alternativos` (aliasDeContacto). Se trae solo esa y se reconstruye la forma que espera el
    // resto del código.
    read<ContactoProyectado>(
      'contacts',
      'id,email,full_name,emails_alternativos:custom_fields->emails_alternativos'
    ).then((rows) =>
      rows.map(({ emails_alternativos, ...c }): Contact => ({
        ...c,
        custom_fields: emails_alternativos == null ? {} : { emails_alternativos },
      }))
    ),
    read<{ payment_reference: string | null }>('collections', 'payment_reference', (q) =>
      referencias ? q.in('payment_reference', referencias) : q.not('payment_reference', 'is', null)
    ),
    closerId
      ? read<{ contact_id: string; closer_id: string | null }>('appointments', 'contact_id,closer_id')
      : Promise.resolve([]),
    closerId
      ? read<{ contact_id: string; closer_id: string | null }>('sales', 'contact_id,closer_id')
      : Promise.resolve([]),
    clientesDelPago && clientesDelPago.length === 0
      ? Promise.resolve([])
      : read<{ stripe_customer_id: string; contact_id: string | null; name: string | null }>(
          'stripe_customers',
          'stripe_customer_id,contact_id,name',
          clientesDelPago ? (q) => q.in('stripe_customer_id', clientesDelPago) : undefined
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
