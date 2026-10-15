import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { computeFunnel } from '../lib/funnels/compute.ts'

const ok = (value, source = 'crm') => ({ value, status: 'ok', source, lastSync: null })

test('con denominadores solo-ads, el coste por etapa usa lo atribuido a anuncios', () => {
  const r = computeFunnel({
    family: 'vsl',
    counts: {
      impresiones: ok(35000, 'meta'),
      clics: ok(776, 'meta'),
      visitas: ok(58, 'vsl'),
      leads: ok(253),
      agendas: ok(158),
      llamadas: ok(38),
      cierres: ok(13),
    },
    inversion: 1000,
    denominadoresCoste: { agendas: 40, llamadas: 10, cierres: 4 },
  })
  const por = Object.fromEntries(r.stages.map((s) => [s.stage.id, s]))
  assert.equal(por.agendas.costPerUnit, 25) // 1000 / 40 de ads, no 1000 / 158
  assert.equal(por.agendas.baseCoste, 'ads')
  assert.equal(por.cierres.costPerUnit, 250)
  // Sin denominador de ads (opt-ins) se mantiene sobre todo el CRM y se declara.
  assert.ok(Math.abs(por.leads.costPerUnit - 1000 / 253) < 1e-9)
  assert.equal(por.leads.baseCoste, 'todo')
})

test('si no hay NINGUNA actividad atribuida a ads el coste es «sin dato», no la inversión repartida', () => {
  const r = computeFunnel({
    family: 'vsl',
    counts: {
      impresiones: ok(100, 'meta'),
      clics: ok(10, 'meta'),
      visitas: ok(5, 'vsl'),
      leads: ok(9),
      agendas: ok(3),
      llamadas: ok(2),
      cierres: ok(1),
    },
    inversion: 500,
    denominadoresCoste: { agendas: 0, llamadas: 0, cierres: 0 },
  })
  const por = Object.fromEntries(r.stages.map((s) => [s.stage.id, s]))
  assert.equal(por.agendas.costPerUnit, null)
  assert.equal(por.cierres.costPerUnit, null)
})

test('el cargador define la población de ads por campaña o por cita de origen anuncio', () => {
  const q = readFileSync(new URL('../lib/funnels/queries.ts', import.meta.url), 'utf8')
  assert.match(q, /esOrigenAnuncio\(\{ utmSource: a\.utm_source, utmMedium: a\.utm_medium \}\)/)
  assert.match(q, /if \(c\.campaign_id\) idsAds\.add\(c\.id\)/)
  assert.doesNotMatch(q, /denominadoresCoste = \{\s*leads:/)
})
