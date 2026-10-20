import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tabla = readFileSync('components/os/AdsTable.tsx', 'utf8')
const pagina = readFileSync('app/[tenant]/marketing/adquisicion/campanas/page.tsx', 'utf8')

test('AdsTable oculta los anuncios de cuentas de Meta no seleccionadas', () => {
  assert.match(tabla, /incluyeCuenta\(a\.account_id\)/)
  assert.doesNotMatch(tabla, /const \[ads, setAds\]/)
})

test('la página de campañas pasa la selección de cuentas a AdsTable', () => {
  assert.match(pagina, /<AdsTable[^>]*incluyeCuenta=\{cuentas\.incluye\}/)
  assert.match(pagina, /<AdsTable campaigns=\{itemsFiltrados\}/)
})
