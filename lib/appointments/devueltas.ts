// CONTACTOS DEVUELTOS: quien pagó o reservó y luego recibió la devolución (p. ej. por Stripe).
//
// Es una MARCA para que todo el equipo —colaboradoras incluidas— vea que esa cita ya no es una venta
// viva, sin tocar ninguna métrica: no cambia el estado de la cita ni crea una categoría nueva. Dos
// fuentes, ambas ya existentes: la venta en estado `refunded`, y el espejo de Stripe
// (`stripe_payments.status = 'refunded'`) cruzado por email, que es lo que detecta una devolución
// hecha directamente en Stripe aunque la app aún no tenga la venta.
//
// Solo cuenta una devolución TOTAL del espejo (`refunded`): una parcial deja a la persona con parte
// pagada y no es «devuelto». Puro: no sabe nada de Supabase.

export type ContactoBasico = { id: string; email: string | null }
export type PagoEspejo = { customer_email: string | null; status: string | null }
export type VentaBasica = { contact_id: string | null; status: string | null }

const norm = (e: string | null | undefined) => (e ?? '').trim().toLowerCase()

export function contactosDevueltos(
  contactos: readonly ContactoBasico[],
  pagos: readonly PagoEspejo[],
  ventas: readonly VentaBasica[]
): Set<string> {
  const emailsDevueltos = new Set(
    pagos.filter((p) => p.status === 'refunded' && norm(p.customer_email)).map((p) => norm(p.customer_email))
  )
  const idsDeVentas = new Set(
    ventas.filter((v) => v.status === 'refunded' && v.contact_id).map((v) => v.contact_id as string)
  )
  // Quien ya volvió a comprar (venta activa) es cliente vigente: no se le marca Devuelto.
  const idsConVentaViva = new Set(
    ventas.filter((v) => v.status === 'active' && v.contact_id).map((v) => v.contact_id as string)
  )
  const out = new Set<string>()
  for (const c of contactos) {
    if (idsConVentaViva.has(c.id)) continue
    if (idsDeVentas.has(c.id) || (norm(c.email) && emailsDevueltos.has(norm(c.email)))) out.add(c.id)
  }
  return out
}
