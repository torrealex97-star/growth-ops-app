import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { esConsultaSoloLectura, sinLiteralesNiComentarios } from '../lib/mcp/sql-executor.ts'
import { puedeAccederAFila } from '../lib/auth/acceso-por-propiedad.ts'

const leer = (p) => readFileSync(p, 'utf8')

// ── MCP: el filtro de solo lectura no se deja engañar por comentarios, literales ni dollar-quoting
test('query_db: una comilla dentro de un comentario ya no esconde sentencias posteriores', () => {
  const ataques = [
    "select 1 /* ' */; reset role; select id from auth.users /* ' */",
    "select 1 -- '\n; reset role; select 1 -- '",
    "select 1 /* ' */ ; set_config('role','postgres',false) /* ' */",
    'select 1; reset role',
    'select $$ a $$; reset role',
    'select 1 /* sin cerrar',
    "select 'sin cerrar",
    'select $tag$ sin cerrar',
    'select 1 /* /* anidado */ ; reset role',
    'select * into nueva from contacts',
    'select pg_sleep(100)',
  ]
  for (const a of ataques) assert.equal(esConsultaSoloLectura(a), false, a)
})

test('query_db: las consultas legítimas siguen pasando (literales, comentarios y dollar-quoting inocuos)', () => {
  const ok = [
    "select * from contacts where full_name = 'O''Brien' limit 10",
    "select id /* cuenta */ from contacts -- comentario\n where tenant_id = 'x'",
    'select $$ texto con ; punto y coma $$ as t',
    'with c as (select 1) select * from c',
    'select "Mi columna" from t',
    "select E'a\\'b; reset role' as t",
    "select count(*) from contacts where notes ilike '%reset role%'",
  ]
  for (const q of ok) assert.equal(esConsultaSoloLectura(q), true, q)
  assert.equal(sinLiteralesNiComentarios("select 'a' /* b */ -- c").replace(/\s+/g, ' ').trim(), "select ''")
})

test('el ejecutor usa el protocolo EXTENDIDO (una sentencia por construcción)', () => {
  assert.match(leer('lib/mcp/sql-executor.ts'), /simple: false/)
})

// ── Rutas con service-role: el control de acceso se repite en servidor
const sinRol = { userId: 'u', role: 'afiliado', isSuperAdmin: false, dataScope: 'own' }
test('acceso por propiedad: liderazgo y super admin sí; comercial solo lo suyo o con visibilidad de equipo; el resto no', () => {
  const fila = { setter_id: 's1', closer_id: 'c1' }
  assert.equal(puedeAccederAFila({ ...sinRol, role: 'admin' }, fila), true)
  assert.equal(puedeAccederAFila({ ...sinRol, role: 'manager' }, fila), true)
  assert.equal(puedeAccederAFila({ ...sinRol, isSuperAdmin: true, role: null }, fila), true)
  assert.equal(puedeAccederAFila({ ...sinRol, role: 'closer', userId: 'c1' }, fila), true)
  assert.equal(puedeAccederAFila({ ...sinRol, role: 'setter', userId: 's1' }, fila), true)
  assert.equal(puedeAccederAFila({ ...sinRol, role: 'closer', userId: 'otro' }, fila), false)
  assert.equal(puedeAccederAFila({ ...sinRol, role: 'closer', userId: 'otro', dataScope: 'team' }, fila), true)
  assert.equal(
    puedeAccederAFila({ ...sinRol, role: 'afiliado', userId: 'c1' }, fila),
    false,
    'un afiliado no, aunque su id coincida'
  )
  assert.equal(puedeAccederAFila({ ...sinRol, role: null }, fila), false)
})

test('las rutas con service-role aplican el control de acceso', () => {
  const base = 'app/api/[tenant]/evergreen/'
  assert.match(leer(base + 'contracts/team/route.ts'), /\['admin', 'director', 'manager', 'csm'\]\.includes\(t\.role\)/)
  assert.match(leer(base + 'contracts/pdf-url/route.ts'), /ROLES_VER_CONTRATOS/)
  assert.match(leer(base + 'contracts/pdf-url/route.ts'), /contract\.user_id !== t\.userId/)
  assert.match(leer(base + 'sales/payment-proof-url/route.ts'), /puedeAccederAFila/)
  assert.match(leer(base + 'ai/queue-call/route.ts'), /puedeAccederAFila/)
  assert.match(
    leer('app/api/public-contracts/sign-student/[token]/route.ts'),
    /update\(\{ phone: sd\.phone \}\)[\s\S]{0,120}\.eq\('tenant_id', tenantId\)/
  )
})

test('transcribe: la URL pasa por el filtro anti-SSRF, sin seguir redirecciones y con tope de tamaño previo', () => {
  const r = leer('app/api/[tenant]/evergreen/instagram/transcribe/route.ts')
  assert.match(r, /esUrlPublicaSegura\(url\)/)
  assert.equal((r.match(/redirect: 'manual'/g) ?? []).length, 2)
  assert.match(r, /content-length/)
})

test('MCP: cada usuario ve y revoca SUS sesiones, no las de los clientes que posee', () => {
  const s = leer('lib/mcp/store.ts')
  const lista = s.slice(
    s.indexOf('export async function listarSesionesDeUsuario'),
    s.indexOf('export async function revocarSesion')
  )
  assert.match(lista, /\.eq\('user_id', userId\)/)
  assert.doesNotMatch(lista, /listarClientesDeUsuario/)
})
