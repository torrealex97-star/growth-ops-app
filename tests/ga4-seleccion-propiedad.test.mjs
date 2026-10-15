import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { clasificarErrorGa4 } from '../lib/google/ga4.ts'

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('un 403 por API desactivada no se presenta como «sin acceso a la propiedad»', () => {
  assert.equal(clasificarErrorGa4(403, { message: 'x', details: [{ reason: 'SERVICE_DISABLED' }] }), 'api_desactivada')
  assert.equal(
    clasificarErrorGa4(403, {
      message: 'Google Analytics Admin API has not been used in project 123 before or it is disabled.',
    }),
    'api_desactivada'
  )
  assert.equal(clasificarErrorGa4(403, { message: 'The caller does not have permission' }), 'sin_acceso')
  assert.equal(clasificarErrorGa4(401), 'token')
  assert.equal(clasificarErrorGa4(500), 'otro')
})

test('la API normaliza el ID manual de la propiedad y rechaza basura', () => {
  const s = leer('app/api/[tenant]/evergreen/ga4/route.ts')
  assert.match(s, /\(\?:properties\\\/\)\?\(\\d\{5,15\}\)/)
  assert.match(s, /body\.propiedad = `properties\/\$\{m\[1\]\}`/)
})

test('la pantalla mapea la respuesta de la API y no deja el selector cargando para siempre', () => {
  const s = leer('app/[tenant]/settings/integraciones/page.tsx')
  assert.match(s, /id: p\.name,/)
  assert.match(s, /setGa4Properties\(\[\]\)/)
  assert.match(s, /ID de la propiedad \(GA4/)
})
