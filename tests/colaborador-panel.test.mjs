import assert from 'node:assert/strict'
import test from 'node:test'

import { construirResumenMensual } from '../lib/commissions/mensual.ts'
import {
  clasificarImpago,
  embudoDelMes,
  historialMensual,
  motivoDeRechazo,
  previsionFutura,
  serieMensual,
  totalGenerado,
} from '../lib/collaborators/panel.ts'

// PANEL DEL COLABORADOR (lógica pura). Placeholders neutros (Privacidad).
const HOY = new Date(2026, 10, 3)

const fila = (o) => ({
  id: o.id,
  sale_id: o.venta ?? `s-${o.id}`,
  collection_id: o.col ?? null,
  user_id: 'u1',
  participant_type: 'collaborator',
  commission_amount: o.amount,
  direction: 'positive',
  status: o.status ?? 'approved',
  liquidation_month: o.liq,
  created_at: '2026-11-02T10:00:00Z',
  users: { full_name: 'Persona Demo', pays_commissions: true },
  sales: { contacts: { full_name: 'Cliente' } },
  collections: o.col ? { collected_at: o.cobro } : null,
})
const futura = (o) => ({
  installmentId: o.id,
  saleId: `s-${o.id}`,
  contact: 'Cliente',
  dueDate: o.fecha,
  userId: 'u1',
  userName: 'P',
  participantType: 'collaborator',
  base: 100,
  percent: 10,
  amount: o.amount,
  source: 'installment',
  estado: 'pending',
  tipo: o.tipo ?? 'recurrente',
})

// octubre: 1000 (nueva 600 + recurrente 400, ya pagado 300); septiembre: 500 pagado; previsión: nov 200, dic 150
const rows = [
  fila({ id: 'a', col: 'c1', cobro: '2026-10-03T10:00:00Z', liq: '2026-11-01', amount: 600 }),
  fila({ id: 'b', venta: 's-a', col: 'c2', cobro: '2026-10-04T10:00:00Z', liq: '2026-11-01', amount: 400 }),
  fila({ id: 'c', col: 'c3', cobro: '2026-09-05T10:00:00Z', liq: '2026-10-01', amount: 500, status: 'liquidated' }),
]
const future = [
  futura({ id: 'f1', fecha: '2026-11-20', amount: 200 }),
  futura({ id: 'f2', fecha: '2026-12-10', amount: 150 }),
]
const meses = construirResumenMensual(rows, future, rows, HOY, { base: 'cobro' })

test('historial: del mes actual hacia atrás, SIN la previsión, con pagado y por cobrar', () => {
  const h = historialMensual(meses, [], HOY)
  assert.deepEqual(
    h.map((f) => f.month),
    ['2026-10', '2026-09'],
    'noviembre solo tiene previsión: no entra'
  )
  assert.equal(h[0].generado, 1000)
  assert.equal(h[0].pagado, 0)
  assert.equal(h[0].porCobrar, 1000)
  assert.equal(h[1].generado, 500)
  assert.equal(h[1].pagado, 500)
  assert.equal(h[1].porCobrar, 0)
})

test('total generado desde que empezó = suma de lo generado (sin previsión)', () => {
  const t = totalGenerado(historialMensual(meses, [], HOY))
  assert.deepEqual(t, { generado: 1500, pagado: 500, porCobrar: 1000 })
})

test('cada mes lleva su factura; un mes sin comisión pero con factura sigue en el registro', () => {
  const facturas = [
    { id: 'i1', period_month: '2026-09-01', invoice_url: 'x/a.pdf', amount: 500, status: 'pagada' },
    { id: 'i2', period_month: '2026-07-01', invoice_url: 'x/b.pdf', amount: 80, status: 'recibida' },
  ]
  const h = historialMensual(meses, facturas, HOY)
  assert.equal(h.find((f) => f.month === '2026-09').factura.status, 'pagada')
  assert.equal(h.find((f) => f.month === '2026-10').factura, null)
  // julio no está en `meses`, así que sus datos no se inventan: la fila solo existe si el mes está en el resumen
  assert.equal(
    h.find((f) => f.month === '2026-07'),
    undefined
  )
})

test('previsión: aparte, desde este mes en adelante, solo con importe', () => {
  const p = previsionFutura(meses, HOY)
  assert.deepEqual(
    p.map((x) => [x.month, x.importe]),
    [
      ['2026-11', 200],
      ['2026-12', 150],
    ]
  )
})

test('serie del gráfico: 12 meses seguidos hasta el actual, con ceros donde no hay nada', () => {
  const s = serieMensual(meses, HOY, 12)
  assert.equal(s.length, 12)
  assert.equal(s[11].month, '2026-11')
  assert.equal(s[0].month, '2025-12')
  assert.equal(s.find((x) => x.month === '2026-10').nuevo, 600)
  assert.equal(s.find((x) => x.month === '2026-10').recurrente, 400)
  assert.equal(s.find((x) => x.month === '2026-06').nuevo, 0)
})

// ── Embudo desde agendas ──
const cita = (id, fecha, status, contact = 'c' + id) => ({
  id,
  contact_id: contact,
  appointment_datetime: fecha,
  status,
})
const activa = (v) => v.status === 'active'

test('el embudo EMPIEZA en las agendas: agendas → asistieron → ventas; los leads sin agenda no cuentan', () => {
  const citas = [
    cita('1', '2026-10-05T10:00:00Z', 'show'),
    cita('2', '2026-10-06T10:00:00Z', 'completed'),
    cita('3', '2026-10-07T10:00:00Z', 'no_show'),
    cita('4', '2026-10-08T10:00:00Z', 'cancelled'),
    cita('5', '2026-10-09T10:00:00Z', 'scheduled'),
    cita('6', '2026-09-30T10:00:00Z', 'show'),
  ]
  const ventas = [
    { id: 'v1', contact_id: 'c1', gross_amount: 1997, status: 'active', created_at: '2026-10-10T10:00:00Z' },
    { id: 'v2', contact_id: 'c2', gross_amount: 500, status: 'cancelled', created_at: '2026-10-11T10:00:00Z' },
    { id: 'v3', contact_id: 'c1', gross_amount: 100, status: 'active', created_at: '2026-09-11T10:00:00Z' },
  ]
  const e = embudoDelMes(citas, ventas, '2026-10', activa)
  assert.equal(e.agendas, 5)
  assert.equal(e.asistieron, 2)
  assert.equal(e.noAsistieron, 1)
  assert.equal(e.canceladas, 1)
  assert.equal(e.pendientes, 1)
  assert.equal(e.ventas, 1)
  assert.equal(e.importe, 1997)
  assert.equal(e.pctAsistencia, 40)
  assert.equal(e.pctVenta, 50)
})

test('embudo de un mes sin agendas: todo a cero, sin dividir por cero', () => {
  const e = embudoDelMes([], [], '2026-10', activa)
  assert.deepEqual(e, {
    agendas: 0,
    asistieron: 0,
    noAsistieron: 0,
    canceladas: 0,
    pendientes: 0,
    ventas: 0,
    importe: 0,
    pctAsistencia: 0,
    pctVenta: 0,
  })
})

// ── Impagos según Stripe ──
const cuota = { vencimiento: '2026-11-02', importe: 199.7 }

test('cuota vencida que Stripe YA cobró: NO es impago, está pendiente de registrar', () => {
  const r = clasificarImpago(cuota, [{ amount: 199.7, paid_at: '2026-11-02T11:57:00Z', status: 'succeeded' }], null)
  assert.equal(r.tipo, 'pagado_pendiente_registro')
  assert.match(r.texto, /ya pagó en Stripe/)
})

test('un pago correcto de OTRO importe o anterior al vencimiento no cuenta como el de esta cuota', () => {
  const r = clasificarImpago(
    cuota,
    [
      { amount: 50, paid_at: '2026-11-02T10:00:00Z', status: 'succeeded' },
      { amount: 199.7, paid_at: '2026-10-02T10:00:00Z', status: 'succeeded' },
    ],
    null
  )
  assert.equal(r.tipo, 'sin_intento')
})

test('cobro fallido: impago real con el motivo del banco en castellano', () => {
  const r = clasificarImpago(cuota, [], {
    code: 'card_declined',
    declineCode: 'insufficient_funds',
    fecha: '2026-11-03',
  })
  assert.equal(r.tipo, 'pago_rechazado')
  assert.equal(r.motivo, 'Fondos insuficientes en la tarjeta')
  assert.match(r.texto, /Pago rechazado: Fondos insuficientes/)
})

test('motivos: decline_code manda sobre code; si no se conoce, el mensaje del banco; si nada, texto honesto', () => {
  assert.equal(motivoDeRechazo({ code: 'card_declined', declineCode: 'expired_card' }), 'La tarjeta ha caducado')
  assert.equal(motivoDeRechazo({ code: 'card_declined' }), 'La tarjeta fue rechazada por el banco')
  assert.equal(motivoDeRechazo({ message: 'Your card was declined.' }), 'Your card was declined.')
  assert.equal(motivoDeRechazo({}), 'Motivo no informado por el banco')
})

test('sin pago ni fallo: aún no hay intento de cobro', () => {
  assert.equal(clasificarImpago(cuota, [], null).tipo, 'sin_intento')
})
