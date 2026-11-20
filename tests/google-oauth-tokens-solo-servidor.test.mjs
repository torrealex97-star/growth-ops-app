import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raiz = join(import.meta.dirname, '..')
const sql = readFileSync(join(raiz, 'supabase/migrations/20261119100000_google_oauth_tokens_solo_servidor.sql'), 'utf8')
const ejecutable = sql
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n')

test('los tokens de Google no se conceden a anon ni a authenticated', () => {
  assert.match(ejecutable, /REVOKE ALL ON public\.google_oauth_connections FROM anon, authenticated;/)
  const grant = ejecutable.match(/GRANT SELECT \(([\s\S]*?)\) ON public\.google_oauth_connections TO authenticated;/)
  assert.ok(grant, 'authenticated solo recibe SELECT por columnas')
  assert.doesNotMatch(grant[1], /refresh_token|access_token\b/, 'ninguna columna con token se concede')
  assert.doesNotMatch(ejecutable, /GRANT (ALL|INSERT|UPDATE|DELETE|TRUNCATE)/)
  assert.doesNotMatch(ejecutable, /TO anon/)
})

test('la pantalla de Funnels solo lee columnas no sensibles de la conexión', () => {
  const q = readFileSync(join(raiz, 'lib/funnels/queries.ts'), 'utf8')
  assert.match(q, /\.select\('ga4_property_id,status,last_sync_at'\)/)
})
