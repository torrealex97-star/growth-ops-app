import { test } from 'node:test'
import assert from 'node:assert/strict'
import { funnelMultiToque } from '../lib/analytics.ts'

const atr = (contact_id, { source, last, firstAt, lastAt }) => ({
  contact_id,
  source,
  utm_source: source,
  utm_campaign: null,
  utm_content: null,
  is_primary: true,
  last_utm_source: last,
  first_touch_at: firstAt ?? null,
  last_touch_at: lastAt ?? null,
})
const venta = (contact_id, gross = 1000) => ({
  id: `v-${contact_id}`,
  contact_id,
  status: 'active',
  gross_amount: gross,
  sale_date: '2026-10-01',
  reservation_completed_at: null,
})

const get = (rows, s) => rows.find((r) => r.source === s)

test('mismo canal en primer y último toque: se lleva el 100%, no un 50% de sí mismo', () => {
  const a = [atr('a', { source: 'instagram', last: 'instagram' })]
  const rows = funnelMultiToque(['a'], a, [venta('a')])
  assert.equal(get(rows, 'instagram').leads, 1)
  assert.equal(get(rows, 'instagram').sales, 1)
  assert.equal(rows.length, 1)
})

test("modelo 'reparto': 50/50 fijo entre primer y último toque cuando difieren", () => {
  const a = [atr('a', { source: 'instagram', last: 'email' })]
  const rows = funnelMultiToque(['a'], a, [venta('a')], 'reparto')
  assert.equal(get(rows, 'instagram').leads, 0.5)
  assert.equal(get(rows, 'email').leads, 0.5)
  assert.equal(get(rows, 'instagram').sales, 0.5)
  assert.equal(get(rows, 'email').gross, 500)
})

test("modelo 'decaimiento' con gap cero converge a 50/50 igual que 'reparto'", () => {
  const a = [
    atr('a', { source: 'instagram', last: 'email', firstAt: '2026-10-01T10:00:00Z', lastAt: '2026-10-01T10:00:00Z' }),
  ]
  const rows = funnelMultiToque(['a'], a, [], 'decaimiento')
  assert.equal(get(rows, 'instagram').leads, 0.5)
  assert.equal(get(rows, 'email').leads, 0.5)
})

test("modelo 'decaimiento': cuanto más viejo el primer toque frente al último, más credita al último", () => {
  const a = [
    atr('a', { source: 'instagram', last: 'email', firstAt: '2026-09-01T00:00:00Z', lastAt: '2026-10-01T00:00:00Z' }),
  ]
  const rows = funnelMultiToque(['a'], a, [], 'decaimiento')
  const email = get(rows, 'email').leads
  const instagram = get(rows, 'instagram').leads
  assert.ok(email > 0.9, `el último toque debería dominar tras 30 días de diferencia, fue ${email}`)
  assert.ok(instagram < 0.1)
  assert.ok(Math.abs(email + instagram - 1) < 1e-9)
})

test('sin last_utm_source (o de sistema, ya filtrado por labelSource) se queda con el primer toque al 100%', () => {
  const a = [atr('a', { source: 'tiktok', last: null })]
  const rows = funnelMultiToque(['a'], a, [])
  assert.equal(rows.length, 1)
  assert.equal(get(rows, 'tiktok').leads, 1)
})

test('una venta de un contacto sin atribución registrada cae en el fallback, no se pierde', () => {
  const rows = funnelMultiToque(['a'], [], [venta('a')])
  assert.equal(rows[0].leads, 1)
  assert.equal(rows[0].sales, 1)
})
