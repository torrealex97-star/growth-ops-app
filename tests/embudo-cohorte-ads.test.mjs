import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cohorteDeLeads } from '../lib/funnels/cohorte.ts'

test('la sub-cohorte de anuncios solo cuenta leads con campaña y sus conversiones', () => {
  const ahora = new Date('2026-10-15T12:00:00Z')
  const contactos = [
    { id: 'a', email: 'a@x.test', created_at: '2026-08-01T10:00:00Z', campaign_id: 'c1' },
    { id: 'b', email: 'b@x.test', created_at: '2026-08-02T10:00:00Z', campaign_id: null },
  ]
  const citas = [
    { contact_id: 'a', status: 'show', appointment_datetime: '2026-08-05T10:00:00Z' },
    { contact_id: 'b', status: 'show', appointment_datetime: '2026-08-06T10:00:00Z' },
  ]
  const c = cohorteDeLeads(contactos, citas, [], { from: new Date('2026-08-01T00:00:00Z'), to: ahora }, ahora)
  assert.equal(c.leads, 2)
  assert.equal(c.ads.leads, 1)
  assert.equal(c.ads.conAsistencia, 1)
  assert.equal(c.conAsistencia, 2)
})
