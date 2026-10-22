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
  assert.match(authorize, /TODAS las subcuentas/)
  assert.match(authorize, /únicamente a los datos de TU subcuenta/)
})
