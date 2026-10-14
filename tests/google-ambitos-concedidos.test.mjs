import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ambitosFaltantes, SCOPES } from '../lib/google/oauth.ts'

const GA = 'https://www.googleapis.com/auth/analytics.readonly'

test('Google concede email como URL completa: no es un permiso que falte', () => {
  const concedido = `openid https://www.googleapis.com/auth/userinfo.email ${GA}`
  assert.deepEqual(ambitosFaltantes(SCOPES.ga4, concedido), [])
})

test('un permiso realmente no concedido sí se reporta', () => {
  const sinGa = 'openid https://www.googleapis.com/auth/userinfo.email'
  assert.deepEqual(ambitosFaltantes(SCOPES.ga4, sinGa), [GA])
})

test('el alias corto y la URL completa son el mismo ámbito; ausencia total = faltan todos', () => {
  assert.deepEqual(ambitosFaltantes(['email'], 'email'), [])
  assert.deepEqual(ambitosFaltantes(['email'], 'https://www.googleapis.com/auth/userinfo.email'), [])
  assert.deepEqual(ambitosFaltantes(['openid', 'email'], ''), ['openid', 'email'])
  assert.deepEqual(ambitosFaltantes(['openid'], null), ['openid'])
})

test('el callback usa la comparación normalizada, no includes() a pelo', () => {
  const s = readFileSync(new URL('../app/api/oauth/google/callback/route.ts', import.meta.url), 'utf8')
  assert.match(s, /ambitosFaltantes\(SCOPES\[provider\], token\.scope\)/)
  assert.doesNotMatch(s, /SCOPES\[provider\]\.filter\(\(s\) => !granted\.includes\(s\)\)/)
})
