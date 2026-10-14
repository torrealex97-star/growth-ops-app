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

// ── ADS vs WEB: lo que viene de un anuncio lo dice; WEB queda para directo/SEO/referidos ───────────────
import { esOrigenAnuncio } from '../lib/appointments/lead-origin.ts'

const base = { attributionLoaded: true }

test('anuncio por medio de pago, por id de anuncio en la fuente o por red de Meta sin medio orgánico', () => {
  const casos = [
    { utmSource: '120252786405750750', utmMedium: 'paid' },
    { utmSource: 'facebook', utmMedium: 'paid_social' },
    { utmSource: '120252786405750750', utmMedium: null },
    { utmSource: 'fb', utmMedium: 'cpc' },
    { utmSource: 'instagram', utmMedium: null },
  ]
  for (const c of casos) {
    const r = resolveAppointmentLeadOrigin({ ...base, ...c })
    assert.equal(r.kind, 'ads', JSON.stringify(c))
    assert.equal(r.shortLabel, 'ADS')
  }
})

test('directo, SEO, referido y enlaces de bio siguen siendo WEB y no ADS', () => {
  const casos = [
    { utmSource: 'direct', utmMedium: 'none' },
    { utmSource: 'google', utmMedium: 'organic_search' },
    { utmSource: 'chatgpt.com', utmMedium: 'none' },
    { utmSource: 'linktr.ee', utmMedium: 'embed-linktree' },
    { utmSource: 'IG', utmMedium: 'Bio' },
    { utmSource: 'Tk', utmMedium: 'Bio' },
  ]
  for (const c of casos) {
    const r = resolveAppointmentLeadOrigin({ ...base, ...c })
    assert.equal(r.kind, 'web', JSON.stringify(c))
    assert.equal(r.shortLabel, 'WEB')
  }
})

test('un anuncio o campaña de Meta resuelto manda sobre un utm_source genérico', () => {
  const r = resolveAppointmentLeadOrigin({ ...base, utmSource: 'direct', utmMedium: 'none', evidenciaAnuncio: true })
  assert.equal(r.kind, 'ads')
  assert.equal(esOrigenAnuncio({ utmSource: 'direct', utmMedium: 'none' }), false)
})

test('setter y colaborador siguen ganando sobre ads', () => {
  assert.equal(
    resolveAppointmentLeadOrigin({ ...base, setterId: 's1', utmSource: '120252786405750750', utmMedium: 'paid' }).kind,
    'setter'
  )
  assert.equal(
    resolveAppointmentLeadOrigin({
      ...base,
      hasCollaboratorAttribution: true,
      utmSource: 'facebook',
      utmMedium: 'paid',
    }).kind,
    'collaborator'
  )
})

test('sin ninguna señal sigue «sin atribuir», no ADS ni WEB', () => {
  const r = resolveAppointmentLeadOrigin({ ...base })
  assert.equal(r.kind, 'unknown')
})
