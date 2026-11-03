// FEE REAL DE STRIPE — la pieza que falta para la base de comisión neta.
//
// El fee de un pago vive en su balance_transaction (net = gross − fee), no en el
// PaymentIntent. El espejo `stripe_payments` lo guarda en `stripe_fee` (migración
// 20260919100000); este módulo lo trae de la API cuando hace falta:
//
//   · El SYNC (stripePaymentsSync) lo pide en bloque para los pagos que ya toca —
//     una segunda lista con `transfer_data` no hace falta: se consulta el endpoint
//     de balance_transactions por charge.
//   · El MOTOR de comisiones lo pide PUNTUAL (pull bajo demanda) cuando un cobro
//     trae `payment_reference` que el espejo aún no conoce: mejor una lectura
//     pequeña ahora que mostrar una comisión sobre bruto hasta el próximo cron.
//
// Robustez: un fallo de Stripe jamás bloquea un cobro — el llamador usa su fallback
// (fee del plan) y el sync diario cuadra el espejo.

import { stripeGet } from '@/lib/stripe/client'

/** Margen para responder a tiempo antes del corte del runtime (mismo criterio que los crons). */
const SAFETY_MARGIN_MS = 5_000

/**
 * fetchStripeFeesForChargeIds — fees para los cargos del pago que ya se ha leído este turno.
 *
 * DEADLINE-AWARE: cada llamada a Stripe puede costar hasta 20 s (TIMEOUT_MS del cliente), así que
 * el bucle consulta el reloj ANTES de cada fetch: si no queda presupuesto para OTRA llamada
 * completa, se detiene y devuelve `deadlineReached: true` para que quien llama persista lo
 * leído, informe `truncated: true` y continúe en la siguiente ejecución (el upsert es
 * idempotente y los fees ya escritos no se pisan).
 *
 * NUNCA PISA UN FEE BUENO CON NULL: si la lectura de un fee falla (Stripe caído, timeout, red),
 * la fila se omite del resultado — quien ya tiene fee en el espejo lo conserva; quien no lo
 * tiene aún lo recibirá en la siguiente pasada. Los fees de un charge son inmutables en Stripe:
 * re-leerlos cada turno es costo evitable para una siguiente iteración.
 */
export async function fetchStripeFeesForChargeIds(
  secretKey: string,
  accountId: string | null | undefined,
  chargeIds: string[],
  opts: {
    /** Epoch ms límite. Si falta, no hay presupuesto externo: solo limita MAX_FEES por turno. */
    deadline?: number
    /** Fees ya conocidos por charge_id: se piden SOLO los que faltan. */
    yaConFee?: Set<string>
    /** Tope duro de llamadas por turno (cinturón si nadie pasó deadline). */
    maxFees?: number
  } = {}
): Promise<{ fees: Map<string, number>; deadlineReached: boolean }> {
  const fees = new Map<string, number>()
  const pendientes = chargeIds.filter((c) => !opts.yaConFee?.has(c))
  const tope = opts.maxFees ?? 200
  let deadlineReached = false

  for (const chargeId of pendientes.slice(0, tope)) {
    if (opts.deadline != null && Date.now() >= opts.deadline - SAFETY_MARGIN_MS) {
      deadlineReached = true
      break
    }
    try {
      const fee = await fetchStripeFeeForCharge(secretKey, accountId, chargeId)
      if (fee != null) fees.set(chargeId, fee)
    } catch {
      // Fallo puntual de una lectura: se omite (null honesto solo para quien NO tenía fee). El
      // bucle sigue: un fee caído no debe detener los demás ni el upsert del dinero.
      continue
    }
  }

  // Si el tope cortó la cola, también es "no cabía en este turno".
  if (pendientes.length > tope) deadlineReached = true
  return { fees, deadlineReached }
}

export type BalanceTxn = {
  id?: string
  /** Neto en céntimos: gross − fee. Solo informativo aquí. */
  net?: number | null
  fee?: number | null
  /** Detalle de la comisión por concepto (p.ej. `stripe_fee`). */
  fee_details?: { amount?: number | null; type?: string | null }[] | null
  source?: string | null
  /** Moneda del SALDO de la cuenta (en que viene `fee`), NO necesariamente la del cobro. */
  currency?: string | null
  /** Si hubo conversión: importe en moneda del cobro × exchange_rate = importe en moneda del saldo. */
  exchange_rate?: number | null
}

const aEuros = (cent: number | null | undefined): number => Math.round(Number(cent ?? 0)) / 100

/**
 * FEE EN LA MONEDA DEL COBRO (MONEY D2: un importe lleva su moneda y no se asume la base).
 *
 * El `fee` de un balance_transaction viene en la moneda del SALDO de la cuenta. Una cuenta que cobra en EUR
 * pero liquida en USD recibe `fee` en dólares (con `exchange_rate`); restarlo tal cual de un importe en
 * euros sobre-resta ~11-17 % del fee y la base comisionable sale baja. Si saldo y cobro coinciden no hay
 * conversión. Si difieren y no hay tipo de cambio legible NO se adivina: `null` (el llamador usa su
 * fallback), nunca un importe en la moneda equivocada.
 */
export function feeEnMonedaDelCobro(txn: BalanceTxn | null | undefined, monedaCobro?: string | null): number | null {
  if (!txn) return null
  const minor =
    Array.isArray(txn.fee_details) && txn.fee_details.length
      ? txn.fee_details.reduce((s, d) => s + Number(d.amount ?? 0), 0)
      : txn.fee != null
        ? Number(txn.fee)
        : null
  if (minor == null || !Number.isFinite(minor)) return null
  const saldo = txn.currency?.toLowerCase()
  const cobro = monedaCobro?.toLowerCase()
  if (saldo && cobro && saldo !== cobro) {
    const rate = Number(txn.exchange_rate)
    if (!Number.isFinite(rate) || rate <= 0) return null
    return Math.round(minor / rate) / 100
  }
  return aEuros(minor)
}

type StripeChargeConBalance = { currency?: string | null; balance_transaction?: string | BalanceTxn | null }

const feeDeCharge = (charge: StripeChargeConBalance | null | undefined): number | null =>
  feeEnMonedaDelCobro(
    typeof charge?.balance_transaction === 'object' ? (charge.balance_transaction as BalanceTxn) : null,
    charge?.currency
  )

/**
 * Lee el balance_transaction de cada charge/pago y devuelve `referencia → fee en euros`.
 * Acepta tanto `pi_...` como `ch_...`: el pago (expandiendo `latest_charge`) o el charge
 * directo. Una referencia que Stripe no encuentra vuelve sin fee (el llamador usa fallback).
 */
export async function fetchStripeFeesForReferences(
  secretKey: string,
  accountId: string | null | undefined,
  referencias: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const auth = { secretKey, accountId }

  for (const ref of referencias.slice(0, 50)) {
    try {
      if (ref.startsWith('pi_')) {
        // Pago: expandimos su charge y de ahí su balance_transaction.
        const intent = await stripeGet<{ latest_charge?: string | { id?: string } | null }>(
          'payment_intents/' + encodeURIComponent(ref),
          new URLSearchParams({ 'expand[]': 'latest_charge.balance_transaction' }),
          auth
        )
        const chargeId = typeof intent.latest_charge === 'object' ? intent.latest_charge?.id : intent.latest_charge
        if (!chargeId) continue
        const charge = await stripeGet<StripeChargeConBalance>(
          'charges/' + encodeURIComponent(chargeId),
          new URLSearchParams({ 'expand[]': 'balance_transaction' }),
          auth
        )
        const fee = feeDeCharge(charge)
        if (fee != null) out.set(ref, fee)
      } else if (ref.startsWith('ch_')) {
        const charge = await stripeGet<StripeChargeConBalance>(
          'charges/' + encodeURIComponent(ref),
          new URLSearchParams({ 'expand[]': 'balance_transaction' }),
          auth
        )
        const fee = feeDeCharge(charge)
        if (fee != null) out.set(ref, fee)
      }
    } catch {
      // Pago inexistente, clave sin permisos o Stripe caído: sin fee para esta referencia.
      continue
    }
  }
  return out
}

/** Versión por charge_id para el sync (ya tiene el charge expandido, solo falta el balance). */
export async function fetchStripeFeeForCharge(
  secretKey: string,
  accountId: string | null | undefined,
  chargeId: string
): Promise<number | null> {
  if (!chargeId) return null
  try {
    const auth = { secretKey, accountId }
    const charge = await stripeGet<StripeChargeConBalance>(
      'charges/' + encodeURIComponent(chargeId),
      new URLSearchParams({ 'expand[]': 'balance_transaction' }),
      auth
    )
    return feeDeCharge(charge)
  } catch {
    return null
  }
}
