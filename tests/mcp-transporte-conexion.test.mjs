import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const ruta = leer('app/api/mcp/route.ts')

test('el 401 anuncia resource_metadata (RFC 9728) para que el cliente descubra el OAuth', () => {
  assert.match(ruta, /resource_metadata="\$\{origin\}\/\.well-known\/oauth-protected-resource"/)
  assert.match(ruta, /'WWW-Authenticate': desafioBearer\(request\)/)
  assert.match(ruta, /desafioBearer\(request, 'invalid_token'\)/)
})

test('GET con Accept text/event-stream responde 405 y DELETE no falla', () => {
  assert.match(ruta, /includes\('text\/event-stream'\)/)
  assert.match(ruta, /status: 405, headers: \{ Allow: 'POST, DELETE, OPTIONS' \}/)
  assert.match(ruta, /export async function DELETE\(\)/)
  assert.match(ruta, /status: 204/)
})

test('las notificaciones desconocidas se aceptan con 202', () => {
  assert.match(ruta, /startsWith\('notifications\/'\)\) return new NextResponse\(null, \{ status: 202 \}\)/)
})

test('existen los documentos de descubrimiento con sufijo de ruta y la CORS del servidor MCP', () => {
  assert.ok(existsSync(new URL('../app/.well-known/oauth-protected-resource/api/mcp/route.ts', import.meta.url)))
  assert.ok(existsSync(new URL('../app/.well-known/oauth-authorization-server/api/mcp/route.ts', import.meta.url)))
  const cfg = leer('next.config.js')
  assert.match(cfg, /source: '\/api\/mcp', headers: corsMcp/)
  assert.match(cfg, /Mcp-Protocol-Version/)
  assert.match(cfg, /source: '\/\.well-known\/:path\*', headers: corsMcp/)
})
