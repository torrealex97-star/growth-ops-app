import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { credencialesBasic, redirectUriPermitida } from '../lib/mcp/oauth.ts'

// «Bad Request» al conectar ChatGPT/Claude tras pulsar Autorizar. Causa real (verificada en la BD de
// producción: 4 códigos emitidos, 0 canjeados, 0 tokens): el POST del consentimiento redirigía con el 307 por
// defecto de NextResponse.redirect, que conserva el método y reenvía el POST al callback del cliente.

const authorize = readFileSync('app/api/mcp/oauth/authorize/route.ts', 'utf8')

test('el POST del consentimiento redirige SIEMPRE con 303 (nunca con el 307 por defecto)', () => {
  const post = authorize.slice(authorize.indexOf('export async function POST'))
  assert.doesNotMatch(post, /NextResponse\.redirect\(/, 'en el POST solo se usa redirigirTrasPost')
  assert.match(authorize, /function redirigirTrasPost[\s\S]*status: 303/)
})

test('credenciales por Authorization: Basic (client_secret_basic)', () => {
  const b64 = (s) => 'Basic ' + Buffer.from(s).toString('base64')
  assert.deepEqual(credencialesBasic(b64('mcp_abc:secreto')), { clientId: 'mcp_abc', clientSecret: 'secreto' })
  assert.deepEqual(credencialesBasic(b64('mcp_abc:a%3Ab')), { clientId: 'mcp_abc', clientSecret: 'a:b' })
  assert.deepEqual(credencialesBasic(b64('mcp_abc:')), { clientId: 'mcp_abc', clientSecret: '' })
  assert.equal(credencialesBasic(null), null)
  assert.equal(credencialesBasic('Bearer xyz'), null)
  assert.equal(credencialesBasic(b64('sin-separador')), null)
})

test('el token endpoint usa Basic solo si el cuerpo no trae las credenciales', () => {
  const t = readFileSync('app/api/mcp/oauth/token/route.ts', 'utf8')
  assert.match(t, /credencialesBasic\(request\.headers\.get\('authorization'\)\)/)
  assert.match(t, /typeof body\.client_id !== 'string' \|\| !body\.client_id/)
})

test('la metadata anuncia client_secret_basic además de post y none', () => {
  const m = readFileSync('app/.well-known/oauth-authorization-server/route.ts', 'utf8')
  assert.match(m, /'none', 'client_secret_post', 'client_secret_basic'/)
})

test('redirect_uri: https siempre; http solo en loopback; nada con credenciales ni fragmento', () => {
  assert.equal(redirectUriPermitida('https://chatgpt.com/connector/oauth/abc'), true)
  assert.equal(redirectUriPermitida('https://claude.ai/api/mcp/auth_callback'), true)
  assert.equal(redirectUriPermitida('http://localhost:54321/callback'), true)
  assert.equal(redirectUriPermitida('http://127.0.0.1:8080/cb'), true)
  assert.equal(redirectUriPermitida('http://[::1]:8080/cb'), true)
  assert.equal(redirectUriPermitida('http://evil.example/cb'), false)
  assert.equal(redirectUriPermitida('http://localhost.evil.example/cb'), false)
  assert.equal(redirectUriPermitida('https://user:pw@chatgpt.com/cb'), false)
  assert.equal(redirectUriPermitida('https://chatgpt.com/cb#x'), false)
  assert.equal(redirectUriPermitida('javascript:alert(1)'), false)
  assert.equal(redirectUriPermitida('no es url'), false)
})

test('el registro devuelve el método de autenticación que el cliente pidió', () => {
  const r = readFileSync('app/api/mcp/oauth/register/route.ts', 'utf8')
  assert.match(r, /METODOS_AUTH\.find\(\(m\) => m === body\.token_endpoint_auth_method\)/)
  assert.match(r, /redirectUriPermitida\(uri\)/)
})

// ── Alcance de los datos: solo el super admin ve todas las subcuentas; el resto, su subcuenta y su rol.
test('el MCP hereda el aislamiento del usuario: claims reales + rol sin BYPASSRLS + solo lectura', () => {
  const ex = readFileSync('lib/mcp/sql-executor.ts', 'utf8')
  assert.match(ex, /sub: opts\.userId/, 'las claims llevan el usuario real que autorizó')
  assert.doesNotMatch(ex, /service_role|SERVICE_ROLE/, 'el ejecutor nunca eleva privilegios')
  assert.match(ex, /set local role mcp_reader/)
  assert.match(ex, /transaction_read_only = on/)
  assert.match(
    ex,
    /set_config/,
    'set_config está en la lista de palabras prohibidas para que la consulta no cambie sus claims'
  )
})

test('la pantalla de consentimiento dice qué alcance tendrá según sea super admin o no', () => {
  assert.match(authorize, /rpc\('is_super_admin'\)/)
  const pantalla = readFileSync('lib/mcp/consentimiento.ts', 'utf8')
  assert.match(pantalla, /TODAS las subcuentas/)
  assert.match(pantalla, /únicamente a los datos de TU subcuenta/)
})

// ── Revisión de código: XSS en la pantalla de consentimiento
import { htmlConsentimiento } from '../lib/mcp/consentimiento.ts'

test('consentimiento: nombre del cliente, error y parámetros se escapan (no hay XSS)', () => {
  const params = new URLSearchParams({
    client_id: 'mcp_"><script>x</script>',
    redirect_uri: 'https://evil.example/cb"onmouseover="x',
    state: 's"><img src=x>',
  })
  params.set('"><script>alert(1)</script>', 'v') // nombre de parámetro malicioso
  const html = htmlConsentimiento({
    clientName: '<img src=x onerror=alert(1)>',
    clientId: params.get('client_id'),
    params,
  })
  assert.doesNotMatch(html, /<script>alert|<img src=x|onerror=alert\(1\)>/)
  assert.doesNotMatch(html, /name="[^"]*<script/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  const conError = htmlConsentimiento({
    clientName: 'X',
    clientId: 'a',
    params: new URLSearchParams(),
    error: 'Scope no permitido: <b>x</b>',
  })
  assert.doesNotMatch(conError, /<b>x<\/b>/)
})

test('consentimiento: muestra a qué dominio volverá el código y solo reenvía los campos OAuth', () => {
  const params = new URLSearchParams({
    redirect_uri: 'https://chatgpt.com/connector/oauth/abc',
    client_id: 'mcp_1',
    extra: 'no',
  })
  const html = htmlConsentimiento({ clientName: 'ChatGPT', clientId: 'mcp_1', params })
  assert.match(html, /volverás a <code>chatgpt\.com<\/code>/)
  assert.doesNotMatch(html, /name="extra"/)
  assert.match(html, /name="redirect_uri"/)
})

// ── «Autenticación correcta, descubrimiento fallido»: el Bearer válido se rechazaba siempre
import { validarAccessToken } from '../lib/mcp/oauth.ts'
import { hashToken, signJwt } from '../lib/mcp/crypto.ts'

test('un access token emitido por el servidor se valida (se busca por SHA-256 del token, no por el jti)', async () => {
  process.env.MCP_JWT_SECRET = 'x'.repeat(40)
  const token = signJwt(
    { sub: 'user-1', jti: 'abc', typ: 'mcp_access', scope: 'read', client_id: 'mcp_1' },
    'x'.repeat(40),
    900
  )
  const consultas = []
  const buscar = async (hash) => {
    consultas.push(hash)
    return hash === hashToken(token) ? { user_id: 'user-1', client_id: 'mcp_1' } : null
  }
  const r = await validarAccessToken(token, buscar)
  assert.deepEqual(r, { userId: 'user-1', email: '', clientId: 'mcp_1' })
  assert.deepEqual(consultas, [hashToken(token)])
})

test('token revocado/desconocido, de otro usuario, mal firmado o de otro tipo → rechazado', async () => {
  process.env.MCP_JWT_SECRET = 'x'.repeat(40)
  const firmar = (extra, secreto = 'x'.repeat(40)) =>
    signJwt({ sub: 'user-1', typ: 'mcp_access', ...extra }, secreto, 900)
  assert.equal(await validarAccessToken(firmar({}), async () => null), null, 'no está en BD / revocado')
  assert.equal(
    await validarAccessToken(firmar({}), async () => ({ user_id: 'otro', client_id: 'c' })),
    null,
    'otro usuario'
  )
  assert.equal(
    await validarAccessToken(firmar({}, 'y'.repeat(40)), async () => ({ user_id: 'user-1' })),
    null,
    'firma ajena'
  )
  assert.equal(await validarAccessToken(firmar({ typ: 'otro' }), async () => ({ user_id: 'user-1' })), null, 'tipo')
  assert.equal(await validarAccessToken('basura', async () => ({ user_id: 'user-1' })), null)
})
