import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('la API solo marca bloqueaAcceso si hay un contrato ENVIADO con enlace y sin firmar', () => {
  const s = leer('app/api/[tenant]/evergreen/contracts/my-status/route.ts')
  assert.match(s, /c\.status === 'enviado' && c\.signing_token/)
  assert.match(s, /const bloqueaAcceso = !hasSigned && !!enviadoSinFirmar/)
  assert.match(s, /signingToken: enviadoSinFirmar\?\.signing_token \?\? null/)
})

test('el layout deja pasar a quien no tiene contrato enviado (firmó por otra vía)', () => {
  const s = leer('app/[tenant]/layout.tsx')
  assert.match(s, /res\.data\?\.bloqueaAcceso === true && res\.data\.signingToken/)
  // Ya no se bloquea por «hasSigned === false» a secas, que dejaba fuera a quien no consta en la app.
  assert.doesNotMatch(s, /res\.data\?\.hasSigned === false/)
  assert.doesNotMatch(s, /Aún no tienes ningún contrato asignado/)
})
