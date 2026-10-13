import assert from 'node:assert/strict'
import test from 'node:test'

import { crearPresupuestoCron, cuotaAgotada } from '../lib/perf/presupuesto-cron.ts'

test('reparte el presupuesto global anclado: la suma de cuotas cabe en el presupuesto', () => {
  const now = 1_000_000
  const P = crearPresupuestoCron(45_000, now, 4)
  assert.equal(P.stopAt, 1_045_000)
  const sumaCuotas = P.cuotas.reduce((t, c) => t + c.cuotaMs, 0)
  assert.ok(sumaCuotas <= 45_000 + 1e-6, `suma ${sumaCuotas} no cabe en el presupuesto`)
  // Cuatro cuotas iguales de 11.250 ms, decididas al repartir (no al ejecutarse).
  for (const c of P.cuotas) assert.equal(c.cuotaMs, 11_250)
})

test('los deadlines están anclados al stopAt: la 2ª cuota no se extiende por el reloj', () => {
  const now = 1_000_000
  const P = crearPresupuestoCron(45_000, now, 2)
  // Cuota 22.500: la 1ª cierra en now+22.500 y la 2ª en min(stopAt, now+45.000) = stopAt.
  assert.equal(P.cuotas[0].deadlineMs, 1_022_500)
  assert.equal(P.cuotas[1].deadlineMs, 1_045_000)
  for (const c of P.cuotas) assert.ok(c.deadlineMs <= P.stopAt)
})

// Esto documenta el bug corregido: en el reparto legacy el deadline de la subcuenta n-ésima
// se calculaba DESPUÉS de ejecutar las anteriores (`Date.now() + presupuesto/n` en cada vuelta),
// así que el peor caso del run completo era n × presupuesto. Con cuotas ancladas queda cerrado:
// aunque cada subcuenta consuma TODO su margen, el run acaba en stopAt.
test('simulación al peor caso: el run completo nunca supera el presupuesto global', () => {
  let now = 1_000_000
  const BUDGET = 45_000
  const P3000 = crearPresupuestoCron(BUDGET, now, 3) // cuota 15.000
  let finReal = now
  for (const c of P3000.cuotas) {
    assert.ok(c.deadlineMs <= P3000.stopAt, 'ningún deadline posterior a stopAt')
    if (!cuotaAgotada(c.deadlineMs, now)) finReal = c.deadlineMs
    now = c.deadlineMs // consume su franja hasta el margen
  }
  // Con cuotas de 15.000 ancladas: 1.015.000 → 1.030.000 → 1.045.000 (la 3ª cierra en stopAt).
  assert.equal(finReal, 1_045_000)
  assert.ok(finReal - 1_000_000 <= BUDGET)
})

test('una subcuenta cierra con el presupuesto; cero subcuentas no reparte nada', () => {
  const P1 = crearPresupuestoCron(45_000, 100, 1)
  assert.equal(P1.cuotas[0].deadlineMs, 45_100)
  assert.equal(P1.stopAt, 45_100)
  const P0 = crearPresupuestoCron(45_000, 100, 0)
  assert.deepEqual(P0.cuotas, [])
  assert.equal(P0.stopAt, 45_100)
})

test('cuotas fraccionarias claman al stopAt sin pasarse (n=7, presupuesto 10.000)', () => {
  const now = 1_000_000
  const P = crearPresupuestoCron(10_000, now, 7)
  assert.ok(Math.abs(P.cuotas[0].cuotaMs - 10_000 / 7) < 1e-9)
  // Con 7×1.428,57 la última franja excede stopAt y queda clampeada al margen global.
  const ultima = P.cuotas[P.cuotas.length - 1]
  assert.ok(ultima.deadlineMs <= P.stopAt)
})

test('el corte se declara: una cuota agotada es un booleano, no un error', () => {
  assert.equal(cuotaAgotada(1_000, 999), false)
  assert.equal(cuotaAgotada(1_000, 1_000), true)
  assert.equal(cuotaAgotada(1_000, 1_500), true)
})

test('entradas inválidas se rechazan en vez de heredar silenciosamente', () => {
  assert.throws(() => crearPresupuestoCron(0, 100, 3))
  assert.throws(() => crearPresupuestoCron(-5, 100, 3))
  assert.throws(() => crearPresupuestoCron(1_000, NaN, 3))
  // Un número de subcuentas no finito o negativo se rechaza: nunca heredar silenciosamente
  // ni entrar a bucle sin fin por un count corrupto.
  assert.throws(() => crearPresupuestoCron(1_000, 100, Infinity))
  assert.throws(() => crearPresupuestoCron(1_000, 100, -1))
})
