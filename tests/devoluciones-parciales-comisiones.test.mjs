import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { calculateNegativeCommissionsForRefund } from '../lib/commissions/calculator.ts'

// Una positiva por cobro y participante (así las escribe el motor). Devolución PARCIAL de la venta.
const pos = (i, user = 'closer', tipo = 'closer', base = 100, percent = 10) => ({
  id: `p${i}-${user}`,
  tenant_id: 't',
  sale_id: 'S',
  collection_id: `col${i}`,
  user_id: user,
  participant_type: tipo,
  percent,
  base_amount: base,
  commission_amount: (base * percent) / 100,
  direction: 'positive',
})
const neg = (i, base) => ({
  ...pos(i),
  id: `n${i}`,
  direction: 'negative',
  base_amount: base,
  commission_amount: base / 10,
})
const refund = (importe, collection_id = null, id = 'R') => ({
  id,
  sale_id: 'S',
  collection_id,
  commissionable_refund_amount: importe,
})
const suma = (ns, campo) => Math.round(ns.reduce((s, n) => s + n[campo], 0) * 100) / 100

test('devolución parcial de una venta en 3 cuotas: se reclama UNA vez lo devuelto, no el triple', () => {
  const r = calculateNegativeCommissionsForRefund(refund(100), [pos(1), pos(2), pos(3)])
  assert.equal(suma(r, 'base_amount'), 100, 'la base reclamada es lo devuelto, repartida entre las cuotas')
  assert.equal(suma(r, 'commission_amount'), 10, '10 € de comisión, no 30')
  assert.equal(r.length, 3)
})

test('cada participante responde de SU parte: closer y setter se reparten por separado', () => {
  const ps = [
    pos(1, 'closer', 'closer', 100, 10),
    pos(2, 'closer', 'closer', 100, 10),
    pos(1, 'setter', 'setter', 100, 5),
    pos(2, 'setter', 'setter', 100, 5),
  ]
  const r = calculateNegativeCommissionsForRefund(refund(100), ps)
  assert.equal(
    suma(
      r.filter((n) => n.participant_type === 'closer'),
      'base_amount'
    ),
    100
  )
  assert.equal(
    suma(
      r.filter((n) => n.participant_type === 'setter'),
      'base_amount'
    ),
    100
  )
  assert.equal(suma(r, 'commission_amount'), 10 + 5)
})

test('una segunda devolución parcial no reclama otra vez lo ya reclamado', () => {
  const previas = [pos(1), pos(2), neg(1, 100)] // ya se devolvieron 100 de 200
  const r = calculateNegativeCommissionsForRefund(refund(500, null, 'R2'), previas)
  assert.equal(suma(r, 'base_amount'), 100, 'solo queda por reclamar 100: el resto de la base')
  const completa = calculateNegativeCommissionsForRefund(refund(100, null, 'R3'), [
    pos(1),
    pos(2),
    neg(1, 100),
    neg(2, 100),
  ])
  assert.equal(completa.length, 0, 'sin base pendiente no hay nada que reclamar')
})

test('devolución ligada a un cobro: solo responde ese cobro', () => {
  const r = calculateNegativeCommissionsForRefund(refund(40, 'col2'), [pos(1), pos(2), pos(3)])
  assert.equal(r.length, 1)
  assert.equal(r[0].collection_id, 'col2')
  assert.equal(r[0].base_amount, 40)
})

test('una sola cuota se comporta como antes (reclama min(devuelto, base))', () => {
  assert.equal(calculateNegativeCommissionsForRefund(refund(60), [pos(1)])[0].base_amount, 60)
  assert.equal(calculateNegativeCommissionsForRefund(refund(500), [pos(1)])[0].base_amount, 100)
})

test('la ruta de devoluciones descuenta lo ya devuelto y rechaza ventas ya devueltas del todo', () => {
  const r = readFileSync('app/api/[tenant]/evergreen/refunds/create/route.ts', 'utf8')
  assert.match(r, /from\('refunds'\)[\s\S]{0,200}gross_refund_amount/)
  assert.match(r, /const devolvible = Math\.max\(totalGross - yaDevuelto, 0\)/)
  assert.match(r, /grossRefund > devolvible \+ 0\.01/)
  assert.match(r, /yaDevuelto \+ grossRefund >= totalGross - 0\.01/)
  assert.match(r, /status: 409/)
})
