import assert from 'node:assert/strict'
import test from 'node:test'

import { detectarCaidaShowRate } from '../lib/growth/signals.ts'

const P = (from, to) => ({ from, to })

// Fixture base: ventana comparable, muestras y cobertura correctas, muestra de 100 agendas
// en cada periodo. Shows 72% → 58% es la caída de ejemplo del prompt (§6).
const base = {
  periodoActual: P('2026-10-07', '2026-10-13'),
  periodoBaseline: P('2026-09-30', '2026-10-06'),
  agendasElegiblesActual: 100,
  agendasElegiblesBaseline: 100,
  outcomesConocidosActual: 95,
  showsActual: 58,
  showsBaseline: 72,
  syncSano: true,
  definicionEstable: true,
}

test('fixture 1: caída de Show Rate con datos válidos produce señal con evidencia', () => {
  const s = detectarCaidaShowRate(base)
  assert.equal(s.estado, 'detectada')
  assert.equal(s.severidad, 'warning') // drop 14 pts: warning (10-20); critical por encima de 20
  assert.equal(s.tipo, 'show_rate_caida')
  assert.equal(s.titulo, 'El Show Rate bajó de 72% a 58%')
  assert.deepEqual(s.evidencia, {
    metrica: 'show_rate',
    actual: 0.58,
    baseline: 0.72,
    muestraActual: 100,
    muestraBaseline: 100,
  })
  assert.equal(s.confianza, 'alta')
})

test('fixture 2: mejoras o movimiento de ± puntos no producen señal (sin ruido)', () => {
  const s = detectarCaidaShowRate({ ...base, showsActual: 74 })
  assert.equal(s.estado, 'sin_senal')
})

test('fixture 3: caída con outcomes desconocidos queda NO EVALUABLE, no caída', () => {
  // La falsa alarma clásica: agendas sin resolver (result NULL) que harían caer de mentira.
  const s = detectarCaidaShowRate({ ...base, outcomesConocidosActual: 20 })
  assert.equal(s.estado, 'no_evaluable')
  assert.match(s.razon, /Cobertura de outcomes insuficiente/)
})

test('fixture 4: muestra por debajo del mínimo no emite señal', () => {
  const s = detectarCaidaShowRate({ ...base, agendasElegiblesActual: 15 })
  assert.equal(s.estado, 'no_evaluable')
  assert.match(s.razon, /insuficiente/)
})

test('fixture 5: sync degradado bloquea la comparación (un hueco no es un cero)', () => {
  const s = detectarCaidaShowRate({ ...base, syncSano: false })
  assert.equal(s.estado, 'no_evaluable')
  assert.match(s.razon, /sincronización/)
})

test('fixture 6: definición de "show" cambiada invalida la comparación', () => {
  const s = detectarCaidaShowRate({ ...base, definicionEstable: false })
  assert.equal(s.estado, 'no_evaluable')
  assert.match(s.razon, /definición/)
})

test('fixture 7: agregados ausentes (null) no se comparan contra cero', () => {
  assert.equal(detectarCaidaShowRate({ ...base, agendasElegiblesActual: null }).estado, 'no_evaluable')
  assert.equal(detectarCaidaShowRate({ ...base, showsBaseline: null }).estado, 'no_evaluable')
})

test('fixture 8: caída mayor de 20 puntos es critical, la confianza baja si muestra corta', () => {
  const s = detectarCaidaShowRate({
    ...base,
    agendasElegiblesActual: 40,
    agendasElegiblesBaseline: 40,
    showsActual: 45,
    showsBaseline: 80,
    outcomesConocidosActual: 40,
  })
  assert.equal(s.severidad, 'critical')
  assert.equal(s.confianza, 'media') // n<50 en alguno de los periodos
})

test('fixture 9: el fingerprint estable para dedupe: misma ventana ⇒ mismo fingerprint', () => {
  const s1 = detectarCaidaShowRate(base)
  const s2 = detectarCaidaShowRate({ ...base })
  assert.equal(s1.fingerprint, s2.fingerprint)
  const s3 = detectarCaidaShowRate({ ...base, periodoActual: P('2026-10-14', '2026-10-20') })
  assert.notEqual(s3.fingerprint, s1.fingerprint)
})
