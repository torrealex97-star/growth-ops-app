import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mapConLimite } from '../lib/async/pool.ts'

test('mapConLimite respeta el límite y conserva el orden de entrada', async () => {
  let activos = 0
  let maximo = 0
  const r = await mapConLimite([5, 1, 4, 2, 3, 0], 2, async (n) => {
    activos++
    maximo = Math.max(maximo, activos)
    await new Promise((res) => setTimeout(res, n))
    activos--
    return n * 10
  })
  assert.deepEqual(r, [50, 10, 40, 20, 30, 0])
  assert.ok(maximo <= 2)
})

test('mapConLimite con lista vacía devuelve vacío', async () => {
  assert.deepEqual(await mapConLimite([], 4, async (x) => x), [])
})

test('registrar lee Stripe en paralelo acotado y para limpio al agotar el tiempo', () => {
  const r = readFileSync('app/api/[tenant]/evergreen/stripe-backfill/registrar/route.ts', 'utf8')
  assert.match(r, /mapConLimite\(paymentIds, LECTURAS_STRIPE_EN_PARALELO/)
  assert.match(r, /Date\.now\(\) - inicio > PRESUPUESTO_MS/)
  // El presupuesto se comprueba ANTES de empezar una venta, nunca entre la venta y sus cobros.
  assert.ok(r.indexOf('PRESUPUESTO_MS) {') < r.indexOf('buildSaleFromPayments(filas, choice)'))
})
