import assert from 'node:assert/strict'
import test from 'node:test'

import {
  esClaveDeMes,
  etapaDeMes,
  etiquetaMesLarga,
  limitesDeMes,
  mesActual,
  mesDePagoDe,
  mesVencido,
  mesesDisponibles,
  nombreDeMes,
  sumarMeses,
} from '../lib/commissions/meses.ts'
import { construirResumenMensual } from '../lib/commissions/mensual.ts'

// SELECTOR ÚNICO DE MES DEL COLABORADOR. El mes por defecto es el VENCIDO (el que acaba de cerrar): es el que se
// factura y está por cobrar; lo que sus clientes pagaron en ese mes se le paga el mes siguiente.
// Placeholders neutros (Privacidad): ninguna persona ni subcuenta real.

const HOY = new Date(2026, 10, 3) // 3-nov-2026

test('mes vencido = el anterior al actual (valor por defecto), también en enero', () => {
  assert.equal(mesActual(HOY), '2026-11')
  assert.equal(mesVencido(HOY), '2026-10')
  assert.equal(mesVencido(new Date(2027, 0, 5)), '2026-12')
})

test('sumarMeses cruza años en los dos sentidos', () => {
  assert.equal(sumarMeses('2026-11', 1), '2026-12')
  assert.equal(sumarMeses('2026-12', 1), '2027-01')
  assert.equal(sumarMeses('2026-01', -1), '2025-12')
  assert.equal(sumarMeses('2026-06', -18), '2024-12')
})

test('el mes de pago es el siguiente al de la actividad', () => {
  assert.equal(mesDePagoDe('2026-10'), '2026-11')
  assert.equal(mesDePagoDe('2026-12'), '2027-01')
})

test('meses elegibles: del actual hacia atrás, sin huecos', () => {
  const m = mesesDisponibles(HOY, 12)
  assert.equal(m.length, 13)
  assert.equal(m[0], '2026-11')
  assert.equal(m[1], '2026-10')
  assert.equal(m[12], '2025-11')
  assert.equal(new Set(m).size, 13)
})

test('límites del mes (incluye bisiestos y meses de 30/31 días)', () => {
  assert.deepEqual(limitesDeMes('2026-10'), { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(limitesDeMes('2026-11'), { from: '2026-11-01', to: '2026-11-30' })
  assert.deepEqual(limitesDeMes('2028-02'), { from: '2028-02-01', to: '2028-02-29' })
  assert.deepEqual(limitesDeMes('2027-02'), { from: '2027-02-01', to: '2027-02-28' })
})

test('etiquetas en castellano, solo la inicial en mayúscula', () => {
  assert.equal(etiquetaMesLarga('2026-10'), 'Octubre 2026')
  assert.equal(etiquetaMesLarga('2027-01'), 'Enero 2027')
  assert.equal(nombreDeMes('2026-11'), 'noviembre')
})

test('claves de mes válidas', () => {
  assert.equal(esClaveDeMes('2026-10'), true)
  for (const mal of ['2026-13', '2026-00', '26-10', '2026-10-01', '', null, undefined, 3])
    assert.equal(esClaveDeMes(mal), false, String(mal))
})

test('etapa de un mes frente a hoy', () => {
  assert.equal(etapaDeMes('2026-10', HOY), 'vencido')
  assert.equal(etapaDeMes('2026-11', HOY), 'actual')
  assert.equal(etapaDeMes('2026-12', HOY), 'futuro')
  assert.equal(etapaDeMes('2026-08', HOY), 'anterior')
})

// ── Resumen con base «cobro» (mes de la actividad) ──
const fila = (o) => ({
  id: o.id,
  sale_id: o.sale ?? `s-${o.col}`,
  collection_id: o.col ?? null,
  user_id: 'u1',
  participant_type: 'collaborator',
  commission_amount: o.amount,
  direction: 'positive',
  status: o.status ?? 'approved',
  liquidation_month: o.liq,
  created_at: '2026-11-02T10:00:00Z',
  users: { full_name: 'Persona Demo', pays_commissions: true },
  sales: { contacts: { full_name: o.cliente ?? 'Cliente' } },
  collections: o.col ? { collected_at: o.cobro } : null,
})
const futura = (o) => ({
  installmentId: o.id,
  saleId: `s-${o.id}`,
  contact: 'Cliente',
  dueDate: o.fecha,
  userId: 'u1',
  userName: 'Persona Demo',
  participantType: 'collaborator',
  base: 100,
  percent: 10,
  amount: o.amount,
  source: 'installment',
  estado: o.estado ?? 'pending',
  tipo: o.tipo ?? 'recurrente',
})

test('base «cobro»: lo que se PAGA en noviembre es «octubre» (mes vencido); el ajuste sin cobro va con él', () => {
  const rows = [
    fila({ id: 'a', col: 'c1', cobro: '2026-10-03T10:00:00Z', liq: '2026-11-01', amount: 1551.98 }),
    fila({ id: 'adj', col: null, liq: '2026-11-01', amount: 6.91, status: 'pending' }),
  ]
  const pago = construirResumenMensual(rows, [], rows, HOY)
  const cobro = construirResumenMensual(rows, [], rows, HOY, { base: 'cobro' })
  assert.equal(pago.find((m) => m.month === '2026-11').porCobrar, 1558.89, 'base pago (admin): noviembre')
  assert.equal(cobro.find((m) => m.month === '2026-10').porCobrar, 1558.89, 'base cobro (colaborador): octubre')
  assert.equal(cobro.find((m) => m.month === '2026-11').porCobrar, 0, 'el mes actual aún no tiene nada generado')
})

test('base «cobro»: una cuota futura cae en el mes en que VENCE (cuando el cliente paga), no en el siguiente', () => {
  const f = [futura({ id: 'i1', fecha: '2026-11-20', amount: 168 })]
  const cobro = construirResumenMensual([], f, [], HOY, { base: 'cobro' })
  assert.equal(cobro.find((m) => m.month === '2026-11').prevista, 168)
  const pago = construirResumenMensual([], f, [], HOY, { base: 'pago' })
  assert.equal(pago.find((m) => m.month === '2026-12').prevista, 168, 'la base pago no cambia')
})

test('por defecto la base es «pago» (el admin no cambia) y los impagos siguen fuera de cualquier mes', () => {
  const rows = [fila({ id: 'a', col: 'c1', cobro: '2026-10-03T10:00:00Z', liq: '2026-11-01', amount: 100 })]
  assert.equal(construirResumenMensual(rows, [], rows, HOY).find((m) => m.month === '2026-11').total, 100)
  const impago = [futura({ id: 'x', fecha: '2026-10-10', amount: 75, estado: 'overdue' })]
  const meses = construirResumenMensual([], impago, [], HOY, { base: 'cobro' })
  assert.equal(
    meses.find((m) => m.month === '2026-10'),
    undefined
  )
})

test('`incluir` fuerza que exista el mes elegido aunque esté vacío', () => {
  const meses = construirResumenMensual([], [], [], HOY, { base: 'cobro', incluir: ['2026-10', 'basura'] })
  assert.ok(meses.some((m) => m.month === '2026-10'))
  assert.ok(!meses.some((m) => m.month === 'basura'))
})
