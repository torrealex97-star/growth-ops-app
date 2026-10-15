import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tasasMiDia } from '../lib/dashboard/mi-dia.ts'

const ahora = new Date('2026-10-15T12:00:00Z')
const c = (id, status, f) => ({ id, status, appointment_datetime: f, contacto: null })

test('show sobre resueltas y cierre sobre asistidas del mes', () => {
  const t = tasasMiDia(
    [
      c('1', 'show', '2026-10-02T10:00:00Z'),
      c('2', 'no_show', '2026-10-03T10:00:00Z'),
      c('3', 'completed', '2026-09-20T10:00:00Z'),
      c('4', 'scheduled', '2026-10-04T10:00:00Z'),
    ],
    1,
    ahora
  )
  assert.equal(Math.round(t.show), 67)
  assert.equal(t.asistidasMes, 1)
  assert.equal(t.cierre, 100)
})

test('sin citas resueltas es un hueco, no un cero', () => {
  const t = tasasMiDia([c('1', 'scheduled', '2026-10-04T10:00:00Z')], 0, ahora)
  assert.equal(t.show, null)
  assert.equal(t.cierre, null)
})
