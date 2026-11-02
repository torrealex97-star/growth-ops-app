// AUDITORÍA DE INTEGRIDAD app↔Stripe (solo lectura, pura).
//
// Detecta las clases de descuadre encontradas en la conciliación de nov-2026 para que se vean antes de que
// lleguen a una comisión pagada. No corrige nada: devuelve hallazgos con qué pasa y dónde.
import { cobroPosiblementeDuplicado, type CobroLite } from './integrityGuards'

export type AuditCobro = CobroLite & { processing_fee: number | string | null }
export type AuditPago = {
  payment_id: string
  charge_id: string | null
  customer_email: string | null
  amount: number | string
  refunded_amount: number | string | null
  stripe_fee: number | string | null
  status: string
  paid_at: string | null
}
export type AuditCuota = {
  id: string
  sale_id: string
  due_date: string
  expected_gross_amount: number | string
  status: string
}
export type AuditVenta = {
  id: string
  contact_id: string
  status: string
  gross_amount: number | string
  method: string | null
}

export type HallazgoTipo =
  | 'cobro_manual_duplicado'
  | 'fee_stripe_sin_volcar'
  | 'devolucion_sin_registrar'
  | 'cuota_vencida_con_cobro'
  | 'pago_stripe_sin_cobro'
  | 'ventas_abiertas_del_mismo_contacto'

export type Hallazgo = { tipo: HallazgoTipo; ref: string; detalle: string }

const dia = (s: string | null) => (s ?? '').slice(0, 10)
const DIAS_5 = 5 * 24 * 60 * 60 * 1000

export function auditarIntegridad(input: {
  hoy: string
  cobros: readonly AuditCobro[]
  pagos: readonly AuditPago[]
  cuotas: readonly AuditCuota[]
  ventas: readonly AuditVenta[]
  refundCobroIds: ReadonlySet<string>
}): Hallazgo[] {
  const out: Hallazgo[] = []
  const pagoPorRef = new Map<string, AuditPago>()
  for (const p of input.pagos) {
    pagoPorRef.set(p.payment_id, p)
    if (p.charge_id) pagoPorRef.set(p.charge_id, p)
  }
  const refsCobradas = new Set(input.cobros.map((c) => c.payment_reference).filter((r): r is string => !!r))
  const cobrosPorVenta = new Map<string, AuditCobro[]>()
  for (const c of input.cobros) cobrosPorVenta.set(c.sale_id, [...(cobrosPorVenta.get(c.sale_id) ?? []), c])

  for (const c of input.cobros) {
    if (c.status !== 'collected') continue
    const pago = c.payment_reference ? pagoPorRef.get(c.payment_reference) : undefined
    // 1) Cobro manual (sin referencia) que repite otro cobro de la misma venta.
    if (!c.payment_reference) {
      const otros = (cobrosPorVenta.get(c.sale_id) ?? []).filter((o) => o.id !== c.id && !!o.payment_reference)
      const dup = cobroPosiblementeDuplicado({ amount: Number(c.gross_amount), collectedAt: c.collected_at }, otros)
      if (dup)
        out.push({
          tipo: 'cobro_manual_duplicado',
          ref: c.id,
          detalle: `repite el cobro ${dup.id} (${dup.payment_reference})`,
        })
    }
    // 2) Fee real de Stripe que no está en el cobro (lo lee el P&L).
    if (
      pago?.stripe_fee != null &&
      Number(pago.stripe_fee) > 0 &&
      Math.abs(Number(c.processing_fee ?? 0) - Number(pago.stripe_fee)) > 0.01 &&
      Number(c.processing_fee ?? 0) <= 0
    )
      out.push({
        tipo: 'fee_stripe_sin_volcar',
        ref: c.id,
        detalle: `fee interno ${c.processing_fee ?? 0} vs Stripe ${pago.stripe_fee}`,
      })
    // 3) Devuelto en Stripe y sin fila en refunds: sigue contando como cash.
    if (pago && Number(pago.refunded_amount ?? 0) > 0 && !input.refundCobroIds.has(c.id))
      out.push({ tipo: 'devolucion_sin_registrar', ref: c.id, detalle: `Stripe devolvió ${pago.refunded_amount}` })
  }

  // 4) Cuota vencida/overdue cuando la venta tiene un cobro del mismo importe cerca de su fecha.
  for (const q of input.cuotas) {
    if (q.status !== 'overdue' && !(q.status === 'pending' && q.due_date < input.hoy)) continue
    const due = new Date(q.due_date).getTime()
    const pagado = (cobrosPorVenta.get(q.sale_id) ?? []).find(
      (c) =>
        c.status === 'collected' &&
        Math.abs(Number(c.gross_amount) - Number(q.expected_gross_amount)) <= 1 &&
        Math.abs(new Date(c.collected_at).getTime() - due) <= DIAS_5
    )
    if (pagado)
      out.push({ tipo: 'cuota_vencida_con_cobro', ref: q.id, detalle: `cobro ${pagado.id} sin enlazar a la cuota` })
  }

  // 5) Pago de Stripe correcto sin cobro interno pasados 2 días (la bandeja debería haberlo resuelto).
  const limite = new Date(input.hoy).getTime() - 2 * 24 * 60 * 60 * 1000
  for (const p of input.pagos) {
    if (p.status !== 'succeeded' || refsCobradas.has(p.payment_id) || (p.charge_id && refsCobradas.has(p.charge_id)))
      continue
    if (p.paid_at && new Date(p.paid_at).getTime() < limite)
      out.push({
        tipo: 'pago_stripe_sin_cobro',
        ref: p.payment_id,
        detalle: `${p.amount} € el ${dia(p.paid_at)} (${p.customer_email ?? 'sin email'})`,
      })
  }

  // 6) Dos ventas abiertas (no reserva) del mismo contacto: típico de una venta por cuota.
  const abiertasPorContacto = new Map<string, AuditVenta[]>()
  for (const v of input.ventas) {
    if (v.status !== 'active' || v.method === 'reserva') continue
    const cobrado = (cobrosPorVenta.get(v.id) ?? [])
      .filter((c) => c.status === 'collected')
      .reduce((a, c) => a + Number(c.gross_amount), 0)
    if (Number(v.gross_amount) - cobrado <= 0.01) continue
    abiertasPorContacto.set(v.contact_id, [...(abiertasPorContacto.get(v.contact_id) ?? []), v])
  }
  for (const [contacto, vs] of abiertasPorContacto)
    if (vs.length > 1)
      out.push({ tipo: 'ventas_abiertas_del_mismo_contacto', ref: contacto, detalle: vs.map((v) => v.id).join(', ') })

  return out
}
