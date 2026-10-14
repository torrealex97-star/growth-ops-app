import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { eventosCalendlySinCambios } from '../lib/integrations/citas-sync.ts'

const URI = (n) => `https://api.calendly.com/scheduled_events/${n}`
const ev = (n, extra = {}) => ({
  uri: URI(n),
  updated_at: '2026-10-13T10:00:00Z',
  status: 'active',
  event_memberships: [{ user_email: 'closer@example.test' }],
  ...extra,
})
const fila = (n, extra = {}) => ({
  external_id: URI(n),
  closer: 'u1',
  status: 'scheduled',
  evento_actualizado: '2026-10-13T10:00:00Z',
  ...extra,
})

test('un evento ya guardado y sin cambios se omite (no gasta presupuesto)', () => {
  assert.deepEqual([...eventosCalendlySinCambios([fila('a')], [ev('a')])], [URI('a')])
})

test('un evento nuevo, modificado, cancelado o sin closer resuelto SÍ se procesa', () => {
  const eventos = [ev('nuevo'), ev('mod'), ev('canc', { status: 'canceled' }), ev('sinCloser')]
  const guardadas = [
    fila('mod', { evento_actualizado: '2026-10-01T00:00:00Z' }),
    fila('canc'), // en la app sigue scheduled y Calendly ya lo cancela
    fila('sinCloser', { closer: null }),
  ]
  assert.deepEqual([...eventosCalendlySinCambios(guardadas, eventos)], [])
})

test('cancelado en ambos lados queda omitido; sin dueño que resolver no exige closer', () => {
  const eventos = [ev('c', { status: 'canceled' }), ev('s', { event_memberships: [] })]
  const guardadas = [fila('c', { status: 'cancelled' }), fila('s', { closer: null })]
  assert.deepEqual([...eventosCalendlySinCambios(guardadas, eventos)].sort(), [URI('c'), URI('s')].sort())
})

test('sin updated_at en Calendly o en lo guardado no se omite nada (reprocesar es idempotente)', () => {
  assert.equal(eventosCalendlySinCambios([fila('a')], [ev('a', { updated_at: undefined })]).size, 0)
  assert.equal(eventosCalendlySinCambios([fila('a', { evento_actualizado: null })], [ev('a')]).size, 0)
})

test('varios invitados del mismo evento: basta que uno haya cambiado para reprocesar', () => {
  const guardadas = [fila('a'), fila('a', { evento_actualizado: '2026-09-01T00:00:00Z' })]
  assert.equal(eventosCalendlySinCambios(guardadas, [ev('a')]).size, 0)
})

test('el sync recorre en ASC y omite lo guardado antes de pedir invitees', () => {
  const s = readFileSync(new URL('../lib/integrations/citas-sync.ts', import.meta.url), 'utf8')
  assert.match(s, /url\.searchParams\.set\('sort', 'start_time:asc'\)/)
  assert.doesNotMatch(s, /opts\.desdeInicio \? 'start_time:desc'/)
  assert.ok(s.indexOf('if (sinCambios.has(uri)) continue') < s.indexOf('/invitees?count=100'))
})
