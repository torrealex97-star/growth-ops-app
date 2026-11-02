import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cobroPosiblementeDuplicado, ventasAbiertas } from '../lib/finance/integrityGuards.ts'
import { feesPorAlinear } from '../lib/finance/feeAlignment.ts'
import { auditarIntegridad } from '../lib/finance/integrityAudit.ts'

const cobro = (o = {}) => ({
  id: 'c1',
  sale_id: 's1',
  gross_amount: 665.67,
  collected_at: '2026-09-30T13:16:00Z',
  status: 'collected',
  payment_reference: 'pi_real',
  ...o,
})

test('un cobro manual del mismo importe y día que el pago de Stripe es duplicado (caso Rosana)', () => {
  const d = cobroPosiblementeDuplicado(
    { amount: 665.67, collectedAt: '2026-09-30T09:00:00Z', paymentReference: null },
    [cobro()]
  )
  assert.equal(d?.id, 'c1')
})

test('dos pagos de Stripe con referencias distintas el mismo día NO son duplicado', () => {
  const d = cobroPosiblementeDuplicado(
    { amount: 665.67, collectedAt: '2026-09-30T13:16:00Z', paymentReference: 'pi_otro' },
    [cobro()]
  )
  assert.equal(d, null)
})

test('importe distinto, cobro revertido o fuera de 36 h no son duplicado', () => {
  const nuevo = { amount: 665.67, collectedAt: '2026-09-30T13:16:00Z', paymentReference: null }
  assert.equal(cobroPosiblementeDuplicado({ ...nuevo, amount: 100 }, [cobro()]), null)
  assert.equal(cobroPosiblementeDuplicado(nuevo, [cobro({ status: 'reversed' })]), null)
  assert.equal(cobroPosiblementeDuplicado(nuevo, [cobro({ collected_at: '2026-10-30T13:16:00Z' })]), null)
})

test('ventasAbiertas ignora reservas, ventas completas y no activas', () => {
  const ventas = [
    { id: 'a', status: 'active', gross_amount: 1997, method: 'stripe' },
    { id: 'b', status: 'active', gross_amount: 50, method: 'reserva' },
    { id: 'c', status: 'active', gross_amount: 1997, method: 'stripe' },
    { id: 'd', status: 'cancelled', gross_amount: 1997, method: 'stripe' },
  ]
  const abiertas = ventasAbiertas(
    ventas,
    new Map([
      ['a', 665.67],
      ['c', 1997],
    ])
  )
  assert.deepEqual(
    abiertas.map((v) => v.id),
    ['a']
  )
  assert.equal(abiertas[0].pendiente, 1331.33)
})

test('feesPorAlinear vuelca el fee real de Stripe solo donde difiere', () => {
  const cambios = feesPorAlinear(
    [
      { id: 'x', payment_reference: 'pi_1', processing_fee: 0 },
      { id: 'y', payment_reference: 'pi_2', processing_fee: 40.76 },
      { id: 'z', payment_reference: null, processing_fee: 0 },
    ],
    [
      { payment_id: 'pi_1', charge_id: 'ch_1', stripe_fee: 29.54 },
      { payment_id: 'pi_2', charge_id: 'ch_2', stripe_fee: 40.76 },
    ]
  )
  assert.deepEqual(cambios, [{ collectionId: 'x', fee: 29.54 }])
})

test('auditarIntegridad detecta duplicado manual, fee sin volcar, devolución sin registrar y cuota pagada', () => {
  const hallazgos = auditarIntegridad({
    hoy: '2026-11-02',
    cobros: [
      { ...cobro(), processing_fee: 0 },
      { ...cobro({ id: 'c2', payment_reference: null }), processing_fee: 0 },
      {
        ...cobro({
          id: 'c3',
          sale_id: 's2',
          payment_reference: 'pi_ref',
          gross_amount: 50,
          collected_at: '2026-09-14T10:00:00Z',
        }),
        processing_fee: 1.96,
      },
    ],
    pagos: [
      {
        payment_id: 'pi_real',
        charge_id: null,
        customer_email: 'a@a.es',
        amount: 665.67,
        refunded_amount: 0,
        stripe_fee: 40.76,
        status: 'succeeded',
        paid_at: '2026-09-30T13:16:00Z',
      },
      {
        payment_id: 'pi_ref',
        charge_id: null,
        customer_email: 'b@b.es',
        amount: 50,
        refunded_amount: 50,
        stripe_fee: 1.96,
        status: 'refunded',
        paid_at: '2026-09-14T10:00:00Z',
      },
      {
        payment_id: 'pi_huerfano',
        charge_id: null,
        customer_email: 'c@c.es',
        amount: 199.7,
        refunded_amount: 0,
        stripe_fee: 9,
        status: 'succeeded',
        paid_at: '2026-10-21T10:00:00Z',
      },
    ],
    cuotas: [{ id: 'q1', sale_id: 's1', due_date: '2026-09-30', expected_gross_amount: 665.67, status: 'overdue' }],
    ventas: [
      { id: 's1', contact_id: 'k1', status: 'active', gross_amount: 1997, method: 'stripe' },
      { id: 's3', contact_id: 'k1', status: 'active', gross_amount: 1997, method: 'stripe' },
    ],
    refundCobroIds: new Set(),
  })
  const tipos = hallazgos.map((h) => h.tipo)
  for (const t of [
    'cobro_manual_duplicado',
    'fee_stripe_sin_volcar',
    'devolucion_sin_registrar',
    'cuota_vencida_con_cobro',
    'pago_stripe_sin_cobro',
    'ventas_abiertas_del_mismo_contacto',
  ])
    assert.ok(tipos.includes(t), `falta el hallazgo ${t}`)
})

test('las rutas conectan las guardas y la migración libera created_by', () => {
  const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  const record = rd('../app/api/[tenant]/evergreen/collections/record/route.ts')
  const resolve = rd('../app/api/[tenant]/evergreen/sales/payment-inbox/resolve/route.ts')
  const sync = rd('../lib/finance/stripePaymentsSync.ts')
  const mig = rd('../supabase/migrations/20261102120000_refunds_created_by_nullable.sql')
  assert.match(record, /cobroPosiblementeDuplicado/)
  assert.match(record, /COBRO_DUPLICADO/)
  assert.match(resolve, /ventasAbiertasDelContacto/)
  assert.match(resolve, /VENTA_ABIERTA_EXISTENTE/)
  assert.match(sync, /alinearFeesDeCobros/)
  assert.match(mig, /drop not null/i)
})
