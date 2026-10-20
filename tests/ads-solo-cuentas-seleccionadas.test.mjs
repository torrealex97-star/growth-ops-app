import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tabla = readFileSync('components/os/AdsTable.tsx', 'utf8')
const pagina = readFileSync('app/[tenant]/marketing/adquisicion/campanas/page.tsx', 'utf8')
const ruta = readFileSync('app/api/[tenant]/evergreen/meta/ads-range/route.ts', 'utf8')

test('AdsTable oculta los anuncios de cuentas de Meta no seleccionadas', () => {
  assert.match(tabla, /incluyeCuenta\(a\.account_id\)/)
})

test('Anuncios usa la barra de filtros global (periodo, cuenta y campañas)', () => {
  assert.match(pagina, /view === 'campaigns' \|\| view === 'ads'\) && \(\s*<PeriodFilterBar/)
  for (const prop of [
    'rangeFrom={rangeFrom}',
    'rangeTo={rangeTo}',
    'accountFilter={accountFilter}',
    'selectedCampaignIds={selectedCampaignIds}',
    'incluyeCuenta={cuentas.incluye}',
  ]) {
    assert.ok(pagina.includes(prop), `falta ${prop} en <AdsTable>`)
  }
  assert.doesNotMatch(tabla, /useState\('all'\)/, 'AdsTable no debe tener filtros de cuenta/campaña propios')
})

test('las métricas de Anuncios salen de Meta para el rango, no del total de 90 días guardado', () => {
  assert.match(tabla, /meta\/ads-range/)
  assert.match(ruta, /resolveMetaConfigs/)
  assert.match(ruta, /since: from, until: to/)
})
