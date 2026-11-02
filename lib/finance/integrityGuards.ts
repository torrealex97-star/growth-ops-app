// GUARDAS DE INTEGRIDAD DE COBROS Y VENTAS.
//
// Nacieron de la conciliación app↔Stripe de nov-2026 (docs/MONEY.md D6): cobros manuales duplicados
// de un pago de Stripe ya registrado, y una venta NUEVA creada por cada cuota de una suscripción que
// ya tenía su venta. Son funciones puras (sin I/O) salvo `ventasAbiertasDelContacto`, que solo lee.
import type { SupabaseClient } from '@supabase/supabase-js'

const CENT = 0.01
const VENTANA_DUPLICADO_MS = 36 * 60 * 60 * 1000

export type CobroLite = {
  id: string
  sale_id: string
  gross_amount: number | string
  collected_at: string
  status: string
  payment_reference: string | null
}

const ref = (r: string | null | undefined) => (r ?? '').trim()

/**
 * ¿El cobro que se va a registrar ya existe en esa venta? Mismo importe (±1 céntimo), a menos de 36 h y
 * no revertido. Dos cobros con REFERENCIAS DISTINTAS de pasarela son pagos distintos (dos cuotas iguales el
 * mismo día), así que solo es duplicado si al menos uno de los dos no trae referencia (el manual).
 */
export function cobroPosiblementeDuplicado(
  nuevo: { amount: number; collectedAt: string | Date; paymentReference?: string | null },
  existentes: readonly CobroLite[]
): CobroLite | null {
  const t = new Date(nuevo.collectedAt).getTime()
  if (!Number.isFinite(t)) return null
  const refNueva = ref(nuevo.paymentReference)
  for (const c of existentes) {
    if (c.status === 'reversed') continue
    if (Math.abs(Number(c.gross_amount) - nuevo.amount) > CENT) continue
    if (Math.abs(new Date(c.collected_at).getTime() - t) > VENTANA_DUPLICADO_MS) continue
    const refVieja = ref(c.payment_reference)
    if (refNueva && refVieja && refNueva !== refVieja) continue
    return c
  }
  return null
}

export type VentaAbierta = { id: string; gross_amount: number; cobrado: number; pendiente: number }

/** Venta activa, que no es una reserva, con importe aún por cobrar. */
export function ventasAbiertas(
  ventas: readonly { id: string; status: string; gross_amount: number | string; method: string | null }[],
  cobradoPorVenta: ReadonlyMap<string, number>
): VentaAbierta[] {
  return ventas.flatMap((v) => {
    if (v.status !== 'active' || v.method === 'reserva') return []
    const gross = Number(v.gross_amount)
    const cobrado = cobradoPorVenta.get(v.id) ?? 0
    const pendiente = Math.round((gross - cobrado) * 100) / 100
    return pendiente > CENT ? [{ id: v.id, gross_amount: gross, cobrado, pendiente }] : []
  })
}

/**
 * Ventas abiertas del contacto: si un pago de Stripe llega y el contacto YA tiene una venta a plazos
 * abierta, lo normal es una cuota de esa venta, no una venta nueva (Yolanda, Rosana: una venta duplicada
 * por cada cuota, con su calendario de cuotas "vencidas" falsas).
 */
export async function ventasAbiertasDelContacto(
  sb: SupabaseClient,
  tenantId: string,
  contactId: string
): Promise<VentaAbierta[]> {
  const { data: ventas, error } = await sb
    .from('sales')
    .select('id,status,gross_amount,payment_plans(method)')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .eq('status', 'active')
    .limit(50)
  if (error) throw new Error(`No se pudieron leer las ventas del contacto: ${error.message}`)
  if (!ventas?.length) return []
  const { data: cobros, error: cobrosError } = await sb
    .from('collections')
    .select('sale_id,gross_amount')
    .eq('tenant_id', tenantId)
    .eq('status', 'collected')
    .in(
      'sale_id',
      ventas.map((v) => v.id)
    )
    .limit(1000)
  if (cobrosError) throw new Error(`No se pudieron leer los cobros: ${cobrosError.message}`)
  const cobrado = new Map<string, number>()
  for (const c of cobros ?? []) cobrado.set(c.sale_id, (cobrado.get(c.sale_id) ?? 0) + Number(c.gross_amount))
  return ventasAbiertas(
    ventas.map((v) => {
      const plan = v.payment_plans as { method?: string | null } | { method?: string | null }[] | null
      const method = Array.isArray(plan) ? (plan[0]?.method ?? null) : (plan?.method ?? null)
      return { id: v.id, status: v.status, gross_amount: v.gross_amount, method }
    }),
    cobrado
  )
}
