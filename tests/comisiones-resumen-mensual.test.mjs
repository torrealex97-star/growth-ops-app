import assert from 'node:assert/strict'
import test from 'node:test'

import {
  construirResumenMensual,
  impagosVencidos,
  mesDePago,
  primerCobroPorVenta,
  tipoDeComision,
} from '../lib/commissions/mensual.ts'

// Resumen mes a mes de comisiones: nueva venta vs recurrencia, con personas y clientes.
// Placeholders neutros (Privacidad): ningún tenant ni persona real.

const AHORA = new Date(2026, 10, 15) // 15-nov-2026

const fila = (o) => ({
  id: o.id,
  sale_id: o.sale ?? 's1',
  collection_id: 'collection' in o ? o.collection : 'c1',
  user_id: o.user ?? 'u1',
  participant_type: o.tipo ?? 'closer',
  commission_amount: o.amount,
  direction: o.direction ?? 'positive',
  status: o.status ?? 'pending',
  liquidation_month: o.mes ?? null,
  created_at: o.creada ?? '2026-11-02T10:00:00Z',
  users: { full_name: o.nombre ?? 'Persona A', pays_commissions: true },
  sales: { contacts: { full_name: o.cliente ?? 'Cliente 1' } },
  collections: 'collected' in o ? o.collected : { collected_at: o.cobro ?? '2026-11-02T10:00:00Z' },
})

const futura = (o) => ({
  installmentId: o.id,
  saleId: o.sale ?? 's1',
  contact: o.cliente ?? 'Cliente 1',
  dueDate: o.fecha,
  userId: o.user ?? 'u1',
  userName: o.nombre ?? 'Persona A',
  participantType: 'closer',
  base: 100,
  percent: 10,
  amount: o.amount,
  source: 'installment',
  estado: 'pending',
  tipo: o.tipo ?? 'recurrente',
  exento: o.exento,
})

test('el primer cobro de una venta es NUEVO y los siguientes RECURRENTES', () => {
  const rows = [
    fila({ id: 'a', sale: 's1', cobro: '2026-10-05T09:00:00Z', amount: 50, mes: '2026-10-01' }),
    fila({ id: 'b', sale: 's1', cobro: '2026-11-05T09:00:00Z', amount: 30, mes: '2026-11-01' }),
  ]
  const primeros = primerCobroPorVenta(rows)
  assert.equal(tipoDeComision(rows[0], primeros), 'nuevo')
  assert.equal(tipoDeComision(rows[1], primeros), 'recurrente')
})

test('varios participantes del MISMO cobro son todos nuevos (el cobro es el primero de la venta)', () => {
  const rows = [
    fila({ id: 'a', user: 'u1', tipo: 'closer', amount: 50 }),
    fila({ id: 'b', user: 'u2', tipo: 'setter', amount: 20, nombre: 'Persona B' }),
  ]
  const [mes] = construirResumenMensual(rows, [], rows, AHORA).filter((m) => m.month === '2026-11')
  assert.equal(mes.nuevo.personas.length, 2)
  assert.equal(mes.recurrente.amount, 0)
  assert.equal(mes.nuevo.amount, 70)
})

test('el acotado por persona no convierte una recurrente en nueva: el primer cobro se mira en `basis`', () => {
  const todas = [
    fila({
      id: 'a',
      user: 'u9',
      nombre: 'Otra',
      sale: 's1',
      cobro: '2026-10-05T09:00:00Z',
      amount: 40,
      mes: '2026-10-01',
    }),
    fila({ id: 'b', user: 'u1', sale: 's1', cobro: '2026-11-05T09:00:00Z', amount: 30 }),
  ]
  const soloU1 = todas.filter((r) => r.user_id === 'u1')
  const mes = construirResumenMensual(soloU1, [], todas, AHORA).find((m) => m.month === '2026-11')
  assert.equal(mes.nuevo.amount, 0)
  assert.equal(mes.recurrente.amount, 30)
})

test('devoluciones (negativas) y filas sin cobro van a AJUSTES y restan; canceladas no cuentan', () => {
  const rows = [
    fila({ id: 'a', amount: 100 }),
    fila({ id: 'b', amount: 25, direction: 'negative', collection: null, collected: null }),
    fila({ id: 'c', amount: 999, status: 'cancelled' }),
  ]
  const mes = construirResumenMensual(rows, [], rows, AHORA).find((m) => m.month === '2026-11')
  assert.equal(mes.nuevo.amount, 100)
  assert.equal(mes.ajuste.amount, -25)
  assert.equal(mes.total, 75)
})

test('pagado = liquidado; por cobrar = total − pagado', () => {
  const rows = [
    fila({ id: 'a', amount: 100, status: 'liquidated' }),
    fila({ id: 'b', sale: 's2', amount: 60, status: 'approved' }),
    fila({ id: 'c', sale: 's3', amount: 40, status: 'pending' }),
  ]
  const mes = construirResumenMensual(rows, [], rows, AHORA).find((m) => m.month === '2026-11')
  assert.equal(mes.total, 200)
  assert.equal(mes.pagado, 100)
  assert.equal(mes.porCobrar, 100)
})

test('las cuotas futuras suman en el MES DE PAGO (el siguiente al vencimiento), según su tipo, y se marcan como previsión', () => {
  const futuras = [
    futura({ id: 'i1', fecha: '2026-12-10', amount: 40, tipo: 'recurrente' }),
    futura({ id: 'i2', fecha: '2026-12-20', amount: 70, tipo: 'nuevo', sale: 's7', cliente: 'Cliente 7' }),
  ]
  const dic = construirResumenMensual([], futuras, [], AHORA).find((m) => m.month === '2027-01')
  assert.equal(dic.recurrente.amount, 40)
  assert.equal(dic.nuevo.amount, 70)
  assert.equal(dic.prevista, 110)
  assert.equal(dic.porCobrar, 110)
  assert.equal(dic.nuevo.personas[0].clientes[0].contact, 'Cliente 7')
})

test('las exentas (D9) y los importes 0 nunca suman', () => {
  const futuras = [
    futura({ id: 'i1', fecha: '2026-12-10', amount: 40, exento: true }),
    futura({ id: 'i2', fecha: '2026-12-10', amount: 0 }),
  ]
  const dic = construirResumenMensual([], futuras, [], AHORA).find((m) => m.month === '2027-01')
  assert.equal(dic, undefined, 'una exenta no debe ni crear el mes')
})

test('agrupa por persona y cliente, ordenado por importe, y el mes en curso aparece siempre', () => {
  const rows = [
    fila({ id: 'a', sale: 's1', cliente: 'Cliente 1', amount: 10 }),
    fila({ id: 'b', sale: 's2', cliente: 'Cliente 2', amount: 90, collection: 'c2', cobro: '2026-11-03T10:00:00Z' }),
  ]
  const meses = construirResumenMensual(rows, [], rows, AHORA)
  const nov = meses.find((m) => m.month === '2026-11')
  assert.deepEqual(
    nov.nuevo.personas[0].clientes.map((c) => c.contact),
    ['Cliente 2', 'Cliente 1']
  )
  assert.ok(construirResumenMensual([], [], [], AHORA).some((m) => m.month === '2026-11'))
})

test('las cuotas vencidas sin cobrar (impagos) no suman en ningún mes y se cuentan aparte', () => {
  const futuras = [
    { ...futura({ id: 'i1', fecha: '2026-10-10', amount: 60 }), estado: 'overdue' },
    { ...futura({ id: 'i2', fecha: '2026-12-10', amount: 40 }), estado: 'pending' },
    { ...futura({ id: 'i3', fecha: '2026-09-10', amount: 500, exento: true }), estado: 'overdue' },
  ]
  const meses = construirResumenMensual([], futuras, [], AHORA)
  assert.equal(
    meses.find((m) => m.month === '2026-10'),
    undefined,
    'un impago no crea ni infla su mes'
  )
  assert.equal(meses.find((m) => m.month === '2027-01').porCobrar, 40)
  assert.equal(impagosVencidos(futuras), 60, 'las exentas tampoco cuentan como impago')
})

test('mes de pago = mes siguiente al cobro, también en diciembre y con basura', () => {
  assert.equal(mesDePago('2026-10-26'), '2026-11')
  assert.equal(mesDePago('2026-12-15T10:00:00Z'), '2027-01')
  assert.equal(mesDePago(''), '')
  assert.equal(mesDePago(null), '')
  assert.equal(mesDePago('2026-13-01'), '')
})

test('una cuota que vence este mes NO suma al «por cobrar» de este mes: se paga el siguiente', () => {
  const futuras = [futura({ id: 'i1', fecha: '2026-11-20', amount: 168 })]
  const meses = construirResumenMensual([], futuras, [], AHORA)
  assert.equal(meses.find((m) => m.month === '2026-11').porCobrar, 0)
  assert.equal(meses.find((m) => m.month === '2026-12').porCobrar, 168)
})
