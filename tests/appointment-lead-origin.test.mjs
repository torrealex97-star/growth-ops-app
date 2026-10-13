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
  assert.equal(origin.detail, 'Web · google')
})

test('Calendly y GHL son fuente del registro, no evidencia de adquisición', () => {
  for (const externalSource of ['calendly', 'ghl']) {
    const origin = resolveAppointmentLeadOrigin({
      attributionLoaded: true,
      source: externalSource,
      externalSource,
    })
    assert.equal(origin.kind, 'unknown')
    assert.equal(origin.label, 'Sin atribuir')
  }
})

test('un source de la agenda tampoco sustituye a la evidencia de adquisición', () => {
  const origin = resolveAppointmentLeadOrigin({
    attributionLoaded: true,
    source: 'organic',
    externalSource: 'manual',
  })

  assert.equal(origin.kind, 'unknown')
  assert.equal(origin.label, 'Sin atribuir')
})

test('la ausencia de UTM no se inventa como web, directo u orgánico', () => {
  const origin = resolveAppointmentLeadOrigin({ attributionLoaded: true })

  assert.equal(origin.kind, 'unknown')
  assert.equal(origin.detail, 'No hay una fuente de adquisición verificable')
})

test('un fallo de atribución no se presenta como tráfico web', () => {
  const origin = resolveAppointmentLeadOrigin({ attributionLoaded: false })

  assert.equal(origin.kind, 'unknown')
  assert.equal(origin.shortLabel, '—')
})
