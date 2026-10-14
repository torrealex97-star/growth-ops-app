import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PLATFORM_SETTINGS, definicionDeAjuste } from '../lib/platform/settings.ts'

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('el catálogo es cerrado: solo claves declaradas, secretos marcados y validación de formato', () => {
  assert.deepEqual(PLATFORM_SETTINGS.map((d) => d.key).sort(), [
    'GOOGLE_OAUTH_CLIENT_ID',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'ONBOARDING_INBOUND_SECRET',
  ])
  assert.equal(definicionDeAjuste('MCP_JWT_SECRET'), null, 'las llaves de infraestructura no se gestionan aquí')
  assert.equal(definicionDeAjuste('CONFIG_ENC_KEY'), null)
  assert.equal(definicionDeAjuste('GOOGLE_OAUTH_CLIENT_SECRET').secret, true)
  assert.equal(definicionDeAjuste('GOOGLE_OAUTH_CLIENT_ID').secret, false)
  const id = definicionDeAjuste('GOOGLE_OAUTH_CLIENT_ID')
  assert.equal(id.validar('1234-abc.apps.googleusercontent.com'), null)
  assert.ok(id.validar('no-es-un-client-id'))
  assert.ok(definicionDeAjuste('ONBOARDING_INBOUND_SECRET').validar('corto'))
})

test('la API es solo para super admin, no devuelve secretos y audita sin el valor', () => {
  const r = leer('app/api/[tenant]/evergreen/platform/settings/route.ts')
  assert.match(r, /if \(!t\.isSuperAdmin\)/)
  assert.match(r, /entity_type: 'platform_setting'/)
  assert.match(r, /new_values: \{ key \}/)
  assert.doesNotMatch(r, /new_values: \{[^}]*value/)
  const s = leer('lib/platform/settings.ts')
  assert.match(s, /valor: !def\.secret \? efectivo : null/)
  assert.match(s, /encryptSecret\(limpio\)/)
})

test('la tabla se crea con RLS y sin acceso para anon/authenticated', () => {
  const m = leer('supabase/migrations/20261014120000_platform_settings.sql')
  assert.match(m, /ENABLE ROW LEVEL SECURITY/)
  assert.match(m, /REVOKE ALL ON public\.platform_settings FROM PUBLIC, anon, authenticated/)
  assert.doesNotMatch(m, /CREATE POLICY/)
})

test('Google OAuth y el webhook de onboarding leen el ajuste de plataforma con respaldo de entorno', () => {
  assert.match(leer('lib/google/oauth.ts'), /getPlatformSetting\('GOOGLE_OAUTH_CLIENT_ID'\)/)
  assert.match(
    leer('app/api/[tenant]/evergreen/webhooks/onboarding/route.ts'),
    /getPlatformSetting\('ONBOARDING_INBOUND_SECRET'\)/
  )
  assert.match(leer('lib/platform/settings.ts'), /process\.env\[key\]\?\.trim\(\)/)
})

test('la pantalla de plataforma enlaza a los ajustes globales y exige super admin', () => {
  assert.match(leer('app/[tenant]/settings/platform/page.tsx'), /settings\/platform\/ajustes/)
  assert.match(leer('app/[tenant]/settings/platform/ajustes/page.tsx'), /if \(!sesion\.isSuperAdmin\)/)
})
