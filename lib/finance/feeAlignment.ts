// ALINEA `collections.processing_fee` CON EL FEE REAL DE STRIPE.
//
// El P&L suma `collections.processing_fee` (lib/finance/pnl.ts) mientras que las comisiones leen el fee
// del espejo `stripe_payments.stripe_fee`. Los cobros creados por rutas antiguas (backfill, alta manual)
// se quedaron con 0 o con la estimación del plan: el P&L subestimaba los fees de Stripe (60 cobros, nov-2026).
// El fee de un cargo es inmutable en Stripe, así que reescribirlo es idempotente. No toca cobros sin pago
// de Stripe (manuales: se queda la estimación del plan) ni cobros cuyo fee ya coincide.
import type { SupabaseClient } from '@supabase/supabase-js'

export type FeeAlineado = { collectionId: string; fee: number }

/** Cobros cuyo fee interno difiere del real de Stripe (±1 céntimo). Pura: testeable sin base de datos. */
export function feesPorAlinear(
  cobros: readonly { id: string; payment_reference: string | null; processing_fee: number | string | null }[],
  espejo: readonly { payment_id: string; charge_id: string | null; stripe_fee: number | string | null }[]
): FeeAlineado[] {
  const feePorRef = new Map<string, number>()
  for (const p of espejo) {
    if (p.stripe_fee == null) continue
    feePorRef.set(p.payment_id, Number(p.stripe_fee))
    if (p.charge_id) feePorRef.set(p.charge_id, Number(p.stripe_fee))
  }
  const out: FeeAlineado[] = []
  for (const c of cobros) {
    const fee = c.payment_reference ? feePorRef.get(c.payment_reference) : undefined
    if (fee == null || fee <= 0) continue
    if (Math.abs(Number(c.processing_fee ?? 0) - fee) > 0.01) out.push({ collectionId: c.id, fee })
  }
  return out
}

/** Lee por lotes los cobros con referencia y corrige los que difieren. Devuelve cuántos corrigió. */
export async function alinearFeesDeCobros(sb: SupabaseClient, tenantId: string, limite = 500): Promise<number> {
  const { data: cobros, error } = await sb
    .from('collections')
    .select('id,payment_reference,processing_fee')
    .eq('tenant_id', tenantId)
    .eq('status', 'collected')
    .not('payment_reference', 'is', null)
    .lte('processing_fee', 0)
    .order('collected_at', { ascending: false })
    .limit(limite)
  if (error) throw new Error(`No se pudieron leer los cobros sin fee: ${error.message}`)
  if (!cobros?.length) return 0
  const refs = [...new Set(cobros.map((c) => c.payment_reference as string))]
  const { data: espejo, error: espejoError } = await sb
    .from('stripe_payments')
    .select('payment_id,charge_id,stripe_fee')
    .eq('tenant_id', tenantId)
    .not('stripe_fee', 'is', null)
    .in('payment_id', refs)
  if (espejoError) throw new Error(`No se pudo leer el espejo de Stripe: ${espejoError.message}`)
  const cambios = feesPorAlinear(cobros, espejo ?? [])
  let hechos = 0
  for (const c of cambios) {
    const { error: updError } = await sb
      .from('collections')
      .update({ processing_fee: c.fee })
      .eq('tenant_id', tenantId)
      .eq('id', c.collectionId)
    if (!updError) hechos++
  }
  return hechos
}
