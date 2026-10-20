import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computeFeedback, npsScoreOf } from '../lib/forms/feedback.ts'

const now = Date.parse('2026-10-20T12:00:00Z')
const row = (o) => ({
  form_id: 'f',
  rating: null,
  nps: null,
  teacher: null,
  module: null,
  class_name: null,
  created_at: new Date(now - 86_400_000).toISOString(),
  contact_id: null,
  ...o,
})

test('el NPS se calcula por módulo, clase y profesor sin mezclar unos con otros', () => {
  const s = computeFeedback(
    [
      row({ nps: 10, module: 'Módulo 1', class_name: 'Clase A', teacher: 'Ana' }),
      row({ nps: 9, module: 'Módulo 1', class_name: 'Clase A', teacher: 'Ana' }),
      row({ nps: 2, module: 'Módulo 2', class_name: 'Clase B', teacher: 'Beto' }),
      row({ nps: 8, module: 'Módulo 2', class_name: 'Clase B', teacher: 'Beto' }),
    ],
    now
  )
  const m1 = s.modules.find((g) => g.label === 'Módulo 1')
  const m2 = s.modules.find((g) => g.label === 'Módulo 2')
  assert.equal(m1.npsScore, 100)
  assert.equal(m1.npsResponses, 2)
  assert.equal(m2.npsScore, 0 + -50) // 1 detractor, 1 pasivo => -50
  assert.equal(s.classes.find((g) => g.label === 'Clase A').npsScore, 100)
  assert.equal(s.teachers.find((g) => g.label === 'Beto').npsScore, -50)
  // El global sigue siendo la suma de todo.
  assert.equal(s.nps.score, npsScoreOf([10, 9, 2, 8]))
})

test('un grupo con solo NPS aparece, y sus estrellas no se inventan', () => {
  const s = computeFeedback([row({ nps: 10, module: 'Solo NPS' })], now)
  const g = s.modules.find((x) => x.label === 'Solo NPS')
  assert.equal(g.responses, 0)
  assert.equal(g.average, null)
  assert.equal(g.npsScore, 100)
})

test('el NPS de los grupos no cambia el recuento de valoraciones en estrellas', () => {
  const s = computeFeedback(
    [row({ rating: 5, module: 'M' }), row({ nps: 3, module: 'M' }), row({ rating: 3, module: 'M' })],
    now
  )
  const g = s.modules.find((x) => x.label === 'M')
  assert.equal(g.responses, 2)
  assert.equal(g.average, 4)
  assert.equal(g.npsResponses, 1)
})

test('el envío público ya no escribe en contacts (no se pisa el NPS de nadie)', () => {
  const r = readFileSync('app/api/[tenant]/evergreen/forms/public/[slug]/submit/route.ts', 'utf8')
  assert.doesNotMatch(r, /\.from\('contacts'\)/)
  assert.doesNotMatch(r, /nps_date/)
  assert.match(r, /buscarContactoPorEmail\(sb, form\.tenantId, sem\.email\)/)
})

test('la respuesta guarda formulario, módulo, clase y profesor para segmentar', () => {
  const r = readFileSync('app/api/[tenant]/evergreen/forms/public/[slug]/submit/route.ts', 'utf8')
  for (const campo of [
    'form_id:',
    'nps: sem.nps',
    'module: sem.module',
    'class_name: sem.class',
    'teacher: sem.teacher',
  ]) {
    assert.ok(r.includes(campo), campo)
  }
})
