import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const chart = readFileSync('components/os/FunnelChart.tsx', 'utf8')
const page = readFileSync('app/[tenant]/funnels/page.tsx', 'utf8')

test('el embudo separa tráfico y personas cuando mezcla unidades', () => {
  assert.match(chart, /hayDosTramos/)
  assert.match(chart, /Tráfico \(visitas y clics, no personas\)/)
  assert.match(chart, /Personas \(cada una cuenta una vez\)/)
})

test('marca la mayor fuga sin umbrales inventados', () => {
  assert.match(chart, /iFuga/)
  assert.match(chart, /mayor fuga/)
})

test('el aviso del pixel no pinta un icono sin texto', () => {
  assert.match(page, /trackingEventsSeen === 0 \|\| data\.unconfiguredSources\.includes\('vsl'\)/)
})
