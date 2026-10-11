import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAppointmentLeadOrigin } from '../lib/appointments/lead-origin.ts'

test('la asignación a setter gana frente a cualquier canal web', () => {
  assert.deepEqual(
    resolveAppointmentLeadOrigin({
      setterId: 'setter-1',
      setterName: 'Setter de prueba',
      attributionLoaded: true,
      utmSource: 'meta',
    }),
    {
      kind: 'setter',
      shortLabel: 'SET',
      label: 'Setter',
      detail: 'Setter · Setter de prueba',
    }
  )
})

test('la relación estructurada identifica al colaborador', () => {
  const origin = resolveAppointmentLeadOrigin({
    hasCollaboratorAttribution: true,
    collaboratorName: 'Colaborador de prueba',
    attributionLoaded: true,
  })

  assert.equal(origin.shortLabel, 'COLAB')
  assert.equal(origin.detail, 'Colaborador · Colaborador de prueba')
})

test('sin setter ni colaborador se muestra web y conserva el canal', () => {
  const origin = resolveAppointmentLeadOrigin({ attributionLoaded: true, utmSource: 'google' })

  assert.equal(origin.shortLabel, 'WEB')
  assert.equal(origin.detail, 'Web / directo · google')
})

test('un fallo de atribución no se presenta como tráfico web', () => {
  const origin = resolveAppointmentLeadOrigin({ attributionLoaded: false })

  assert.equal(origin.kind, 'unknown')
  assert.equal(origin.shortLabel, '—')
})
