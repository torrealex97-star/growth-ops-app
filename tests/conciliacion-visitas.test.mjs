import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { conciliarVisitas } from '../lib/tracking/conciliacion.ts'

test('con la captura de hoy (58 de 661) el estado es crítico y lo explica', () => {
  const c = conciliarVisitas({ pixel: 58, meta: 661 })
  assert.equal(c.estado, 'critico')
  assert.equal(Math.round((c.ratio ?? 0) * 100), 9)
  assert.match(c.mensaje, /9 %/)
})

test('de acuerdo (≥70 %), a revisar (40-70 %) y exceso (>130 %)', () => {
  assert.equal(conciliarVisitas({ pixel: 600, meta: 661 }).estado, 'ok')
  assert.equal(conciliarVisitas({ pixel: 330, meta: 661 }).estado, 'revisar')
  assert.equal(conciliarVisitas({ pixel: 1000, meta: 661 }).estado, 'revisar')
})

test('muestra baja y datos que faltan no se convierten en veredicto', () => {
  assert.equal(conciliarVisitas({ pixel: 5, meta: 12 }).estado, 'muestra_baja')
  assert.equal(conciliarVisitas({ pixel: null, meta: 700 }).estado, 'sin_datos')
  assert.equal(conciliarVisitas({ pixel: 10, meta: null }).estado, 'sin_datos')
  assert.equal(conciliarVisitas({ pixel: 0, meta: 0 }).estado, 'muestra_baja')
})

test('el embudo carga landing_views de Meta, concilia y la pantalla lo muestra', () => {
  const q = readFileSync(new URL('../lib/funnels/queries.ts', import.meta.url), 'utf8')
  assert.match(q, /select\('impressions,link_clicks,landing_views,reach,spend,date'\)/)
  assert.match(q, /conciliarVisitas\(\{/)
  const p = readFileSync(new URL('../app/[tenant]/funnels/page.tsx', import.meta.url), 'utf8')
  assert.match(p, /Visitas: píxel frente a Meta/)
})
