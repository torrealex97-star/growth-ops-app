import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

test('YouTube usa el callback OAuth firmado de la app, no OAuth Playground ni códigos pegados', () => {
  const oauth = read('lib/google/oauth.ts')
  const state = read('lib/google/oauth-state.ts')
  const start = read('app/api/[tenant]/evergreen/oauth/google/start/route.ts')
  const ui = read('app/[tenant]/settings/integraciones/page.tsx')

  assert.match(oauth, /GoogleProvider = 'ga4' \| 'calendar' \| 'youtube' \| 'youtube_publish'/)
  assert.match(oauth, /youtube\.upload/)
  assert.match(oauth, /youtube\.readonly/)
  assert.match(state, /provider: 'ga4' \| 'calendar' \| 'youtube' \| 'youtube_publish'/)
  assert.match(start, /provider !== 'youtube'/)
  assert.match(ui, /oauth\/google\/start\?provider=\$\{provider\}/)
  assert.doesNotMatch(ui, /oauthplayground|YOUTUBE_OAUTH_CODE|youtube-exchange/)
})

test('el callback guarda YouTube por tenant en la tabla OAuth común', () => {
  const callback = read('app/api/oauth/google/callback/route.ts')
  assert.match(callback, /tenant_id: tenantId/)
  assert.match(callback, /provider,/)
  assert.match(callback, /refresh_token: encryptSecret\(token\.refresh_token\)/)
  assert.match(callback, /connected_by: userId/)
  assert.match(callback, /from\('google_oauth_connections'\)/)
})

test('YouTube, Calendar y GA4 usan el único cliente OAuth global de la plataforma', () => {
  const oauth = read('lib/google/oauth.ts')
  assert.match(oauth, /process\.env\.GOOGLE_OAUTH_CLIENT_ID/)
  assert.match(oauth, /process\.env\.GOOGLE_OAUTH_CLIENT_SECRET/)
  assert.doesNotMatch(oauth, /YOUTUBE_CLIENT_ID|YOUTUBE_CLIENT_SECRET|integration_settings/)
})

test('el cliente de YouTube ya no conserva OAuth Playground como redirect heredado', () => {
  const client = read('lib/youtube/client.ts')
  assert.match(client, /googleRedirectUri\(\)/)
  assert.doesNotMatch(client, /oauthplayground/)
})
