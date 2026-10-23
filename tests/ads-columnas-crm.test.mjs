import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tabla = readFileSync('components/os/AdsTable.tsx', 'utf8')
const rutaRevenue = readFileSync('app/api/[tenant]/evergreen/meta/revenue-attribution/route.ts', 'utf8')
const atribucion = readFileSync('lib/meta/revenue-attribution.ts', 'utf8')

test('Anuncios lee la atribución canónica (revenue-attribution) con el MISMO periodo que las métricas de Meta', () => {
  assert.match(tabla, /meta\/revenue-attribution/)
  assert.match(tabla, /params\.set\('from', rangeFrom as string\)/)
  assert.match(tabla, /params\.set\('to', rangeTo as string\)/)
})

test('sin filtro de campañas elegido, NO se envía el parámetro campaigns (el endpoint debe mirar todas)', () => {
  assert.match(tabla, /selectedCampaignIds\.length > 0\) params\.set\('campaigns'/)
})

test('las columnas CRM solo aparecen cuando existe atribución a nivel de anuncio con contenido', () => {
  assert.match(
    tabla,
    /mostrarCrm =\s*\n?\s*crmEstado === 'ok' && \[\.\.\.crmFilas\.values\(\)\]\.some\(\(fila\) => fila\.booked > 0 \|\| fila\.sales > 0\)/
  )
  for (const col of ['Agendas', 'Asistencias', 'Cierres']) {
    assert.match(tabla, new RegExp(`>${col}<`))
  }
})

test('un anuncio sin fila de atribución pinta «—», nunca un cero (un hueco no es un cero)', () => {
  assert.match(tabla, /\{crm \? formatNumber\(crm\.booked\) : '—'\}/)
  assert.match(tabla, /\{crm \? formatNumber\(crm\.shows\) : '—'\}/)
  assert.match(tabla, /\{crm \? formatNumber\(crm\.sales\) : '—'\}/)
})

test('las cifras CRM vienen de las filas de anuncios de la atribución, unidas por external_id', () => {
  assert.match(tabla, /ads\.filter\(\(a\) => a\.adId\)\.map\(\(a\) => \[a\.adId as string, a\]\)/)
  assert.match(tabla, /crmFilas\.get\(a\.external_id\)/)
})

test('si la atribución falla, no se pintan columnas CRM vacías: aviso con reintento y tabla Meta intacta', () => {
  assert.match(tabla, /CRM por anuncio ilegible/)
  assert.match(tabla, /Reintentar/)
  assert.match(tabla, /setCrmIntento\(\(n\) => n \+ 1\)/)
  // las columnas dependen de mostrarCrm, que exige crmEstado === 'ok'
  assert.doesNotMatch(tabla, /mostrarCrm = [^\n]*crmEstado === 'error'/)
})

test('la atribución mantiene la cobertura declarada (agendas sin anuncio no se reparten)', () => {
  assert.match(atribucion, /adAttributed/)
  assert.match(tabla, /sinAtribuir/)
})
