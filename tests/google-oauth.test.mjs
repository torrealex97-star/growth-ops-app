import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const CALLBACK = 'app/api/oauth/google/callback/route.ts'
const START = 'app/api/[tenant]/evergreen/oauth/google/start/route.ts'

// El callback vive fuera de /api/[tenant]/ porque el URI de redirección se registra literalmente en
// Google Cloud. Eso significa que NO puede confiar en el middleware ni en la ruta: su única defensa
// es la firma del state. Si esto se rompiera, cualquiera podría guardar el token de su cuenta de
// Google como la conexión de otra subcuenta.
test('el callback verifica la firma del state antes de cualquier otra cosa', () => {
  const code = read(CALLBACK)
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  const cuerpo = code.slice(code.indexOf('export async function GET'))
  const posVerify = cuerpo.indexOf('verifyState(')
  assert.ok(posVerify > 0, 'el callback no verifica el state')
  // Nada de intercambiar el código ni tocar la base antes de validar el state.
  assert.ok(cuerpo.indexOf('exchangeCode(') > posVerify, 'se intercambia el código antes de validar el state')
  assert.ok(cuerpo.indexOf("from('tenants')") > posVerify, 'se consulta la subcuenta antes de validar el state')
  // La subcuenta sale del state verificado, nunca de un parámetro de la URL.
  assert.match(cuerpo, /const \{ tenant, provider, userId, nonce \} = state\.payload/)
  assert.match(cuerpo, /openPkce\(/)
  assert.match(cuerpo, /pkce\.nonce !== nonce/)
  assert.match(cuerpo, /await requireTenant\(tenant\)/)
  assert.match(cuerpo, /session\.userId !== userId/)
  assert.doesNotMatch(cuerpo, /searchParams\.get\('tenant'\)/)
})

test('refresh y access token se guardan cifrados con su caducidad', () => {
  const code = read(CALLBACK)
  assert.match(code, /refresh_token: encryptSecret\(token\.refresh_token\)/)
  assert.match(code, /access_token: token\.access_token \? encryptSecret\(token\.access_token\) : null/)
  assert.match(code, /access_token_expires_at/)
})

test('sin refresh token no se guarda una conexión a medias', () => {
  const code = read(CALLBACK)
  assert.match(code, /token\.error \|\| !token\.refresh_token/)
  assert.match(code, /sin_refresh_token/)
})

test('se guardan los ámbitos concedidos, no los pedidos', () => {
  const code = read(CALLBACK)
  // El usuario puede desmarcar permisos en la pantalla de consentimiento.
  assert.match(code, /const granted = \(token\.scope \|\| ''\)/)
  assert.match(code, /scopes: granted/)
  assert.match(code, /faltan\.length > 0 \? 'error' : 'conectada'/)
})

test('GA4, Calendar y lectura de YouTube usan scopes mínimos; publicar va separado', () => {
  const lib = read('lib/google/oauth.ts')
  const readScopes = lib.slice(lib.indexOf('export const SCOPES'), lib.indexOf('youtube_publish:'))
  assert.match(readScopes, /analytics\.readonly/)
  assert.match(readScopes, /calendar\.events\.readonly/)
  assert.match(readScopes, /youtube\.readonly/)
  assert.match(readScopes, /yt-analytics\.readonly/)
  assert.doesNotMatch(readScopes, /gmail\.|youtube\.upload|analytics\.edit|auth\/calendar['"]/)
  assert.match(lib, /youtube_publish: \['openid', 'email', 'https:\/\/www\.googleapis\.com\/auth\/youtube\.upload'\]/)
})

test('el login con Google conserva el aislamiento por subcuenta después del callback', () => {
  const login = read('app/[tenant]/login/page.tsx')
  const callback = read('app/api/[tenant]/evergreen/auth/callback/route.ts')
  assert.match(login, /signInWithOAuth/)
  assert.match(login, /provider: 'google'/)
  assert.match(login, /api\/\$\{tenant\}\/evergreen\/auth\/callback/)
  assert.match(callback, /from\('tenants'\).*eq\('slug', tenant\).*maybeSingle\(\)/s)
  assert.match(callback, /signOut\(\)/)
  assert.match(callback, /error=no_tenant_access/)
})

test('el flujo pide offline + consent para recibir refresh token', () => {
  const lib = read('lib/google/oauth.ts')
  // Sin esto Google no devuelve refresh_token en las autorizaciones posteriores a la primera.
  assert.match(lib, /access_type', 'offline'/)
  assert.match(lib, /prompt', 'consent'/)
})

test('el cliente OAuth es global y la UI no pide credenciales por subcuenta', () => {
  const oauth = read('lib/google/oauth.ts')
  const catalog = read('lib/integrations-catalog.ts')
  const ui = read('app/[tenant]/settings/integraciones/page.tsx')
  assert.match(oauth, /process\.env\.GOOGLE_OAUTH_CLIENT_ID/)
  assert.match(oauth, /process\.env\.GOOGLE_OAUTH_CLIENT_SECRET/)
  assert.doesNotMatch(catalog, /key: 'GOOGLE_CLIENT_ID'|key: 'GOOGLE_CLIENT_SECRET'/)
  assert.match(ui, /Conecta una cuenta con acceso de lectura a GA4/)
  assert.match(ui, /Canal y analíticas/)
})

test('desconectar revoca el token y el refresh automático marca reautorización', () => {
  const connections = read('app/api/[tenant]/evergreen/oauth/google/connections/route.ts')
  const tokenStore = read('lib/google/token-store.ts')
  assert.match(connections, /revokeGoogleToken\(decryptSecret\(connection\.refresh_token\)\)/)
  assert.match(connections, /eq\('tenant_id', auth\.session\.tenantId\)/)
  assert.match(tokenStore, /body\.error === 'invalid_grant'/)
  assert.match(tokenStore, /reauth_required_at/)
  assert.match(tokenStore, /access_token_expires_at/)
})

test('GA4 explica los permisos y permite elegir una propiedad', () => {
  const route = read(GA4_ROUTE)
  const ui = read('app/[tenant]/settings/integraciones/page.tsx')
  assert.match(route, /Tu cuenta de Google no tiene acceso a esta propiedad de GA4/)
  assert.match(route, /propiedades=1|new URL\(req\.url\).*propiedades/s)
  assert.match(ui, /Guardar propiedad/)
  assert.match(ui, /propiedad: ga4Property/)
})

test('el inicio liga state y PKCE a la sesión; Calendar permite al miembro y GA4/YouTube exigen liderazgo', () => {
  const code = read(START)
  assert.match(code, /await requireTenant\(tenant\)/)
  assert.match(code, /provider !== 'calendar'.*session\.role !== 'admin'/s)
  assert.match(code, /createSignedState\(\{ tenant, provider, userId: session\.userId \}\)/)
  assert.match(code, /createPkce\(\)/)
  assert.match(code, /codeChallenge: pkce\.challenge/)
  // Sin CONFIG_ENC_KEY no se puede firmar: antes fallar que seguir sin firma.
  assert.match(code, /catch \(e\)/)
})

test('Calendar usa scopes mínimos de lectura y se guarda por tenant + usuario', () => {
  const oauth = read('lib/google/oauth.ts')
  const callback = read(CALLBACK)
  assert.match(oauth, /calendar\.calendarlist\.readonly/)
  assert.match(oauth, /calendar\.events\.readonly/)
  assert.doesNotMatch(oauth, /auth\/calendar['"]/)
  assert.match(callback, /owner_user_id: userId/)
  assert.match(callback, /tenant_id,provider,owner_user_id/)
})

test('la migración Calendar conserva appointments como canónica y protege propiedad/RLS', () => {
  const sql = read('supabase/migrations/20261008122259_google_calendar_per_closer_read_only.sql')
  assert.match(sql, /provider IN \('ga4', 'gmail', 'calendar'\)/)
  assert.match(sql, /google_oauth_calendar_requires_owner/)
  assert.match(sql, /UNIQUE \(tenant_id, connection_id, external_calendar_id\)/)
  assert.match(sql, /WHERE role = 'primary' AND is_enabled/)
  assert.match(sql, /owner_user_id = auth\.uid\(\)/)
  assert.doesNotMatch(sql, /CREATE TABLE public\.appointments/)
})

test('el callback está declarado como público en el middleware, con motivo', () => {
  const mw = read('middleware.ts')
  assert.match(mw, /'\/api\/oauth\/google\/callback'/)
  // Debe quedar escrito POR QUÉ es público, o el próximo que lo lea pensará que es un descuido.
  assert.match(mw, /state.*FIRMADO|FIRMADO.*state/s)
})

test('la tabla de conexiones no deja leer credenciales al equipo', () => {
  const sql = read('supabase/migrations/20260913160000_google_oauth_connections.sql')
  assert.match(sql, /CREATE POLICY "google_oauth_admin_all"[\s\S]*is_admin_or_director\(\)/)
  // A diferencia de otras tablas, aquí NO hay política de SELECT para todo el equipo.
  assert.doesNotMatch(sql, /get_my_role\(\) IS NOT NULL/)
  assert.match(sql, /AS RESTRICTIVE FOR ALL/)
  assert.match(sql, /CREATE UNIQUE INDEX google_oauth_tenant_provider_key[\s\S]*\(tenant_id, provider\)/)
})

// ── Sync de GA4 ─────────────────────────────────────────────────────────────
const GA4_ROUTE = 'app/api/[tenant]/evergreen/ga4/route.ts'

test('el sync de GA4 es idempotente por el grano completo, no solo por la fecha', () => {
  const route = read(GA4_ROUTE)
  // GA4 reprocesa sus datos durante ~48 h, así que volver a pedir los últimos días es lo normal.
  // Sin el grano completo en onConflict, cada pasada duplicaría el histórico.
  assert.match(route, /onConflict: 'tenant_id,date,source,medium,campaign,landing_page,device'/)
  assert.match(read('supabase/migrations/20260913170000_ga4_daily.sql'), /ga4_daily_grain_key/)
})

test('el sync cuenta lo escrito de verdad y distingue acceso revocado', () => {
  const route = read(GA4_ROUTE)
  assert.match(route, /\.select\('id'\)/, 'no comprueba qué filas se escribieron')
  assert.match(route, /escritas \+= data\?\.length \?\? 0/)
  // invalid_grant es "hay que volver a conectar", no un fallo temporal que reintentar.
  assert.match(read('lib/google/ga4.ts'), /invalid_grant/)
  assert.match(route, /revocada/)
  assert.match(route, /dryRun/)
})

test('las dimensiones de la tabla son NOT NULL con DEFAULT, no nullable', () => {
  // En Postgres NULL != NULL, así que con dimensiones nullable la clave única dejaría de proteger
  // contra duplicados y el histórico se duplicaría en silencio.
  const sql = read('supabase/migrations/20260913170000_ga4_daily.sql')
  for (const col of ['source', 'medium', 'campaign', 'landing_page', 'device']) {
    assert.match(sql, new RegExp(`${col}\\s+TEXT NOT NULL DEFAULT ''`), `${col} debería ser NOT NULL DEFAULT ''`)
  }
})

// Funnels lee la tabla local, no la API: la pantalla no debe depender de una llamada externa.
test('Funnels lee GA4 de la base y distingue "sin conectar" de "cero sesiones"', () => {
  const q = read('lib/funnels/queries.ts')
  assert.match(q, /from\('ga4_daily'\)/)
  assert.doesNotMatch(q, /analyticsdata\.googleapis\.com/)
  // Cada motivo distinto tiene su mensaje: sin conexión, sin propiedad, sin sincronizar, revocada.
  assert.match(q, /GA4 no está conectado en esta subcuenta/)
  assert.match(q, /no se ha elegido ninguna propiedad/)
  assert.match(q, /todavía no se ha sincronizado/)
  assert.match(q, /revocó el acceso/)
  // El mensaje viejo de "falta el proyecto de Google Cloud" ya no aplica: el proyecto existe.
  assert.doesNotMatch(q, /falta el proyecto de Google Cloud/)
})
