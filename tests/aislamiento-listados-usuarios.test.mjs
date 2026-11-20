import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = (p) => readFileSync(join(raiz, p), 'utf8')

// -------------------------------------------------------------------------------------------------------------------
// LISTADOS DE USUARIOS ACOTADOS A UNA SUBCUENTA.
//
// `users` es identidad global: no tiene `tenant_id` y la pertenencia vive en `tenant_members`. Un
// `from('users').select(…)` sin acotar devuelve a todo el que la política de lectura deje ver, y para el super-admin de la
// plataforma eso es TODA la plataforma: al abrir una subcuenta nueva salían los usuarios de las otras. Se arregló en unas
// pantallas (auditoría F19) y se olvidó en otras 14. Este test hace imposible olvidarlo otra vez: todo LISTADO de `users`
// tiene que pasar por `tenantUsersQuery` (o `activeUserNamesQuery` / `tenantActiveUsers`, que ya acotan).
//
// Quedan fuera las consultas PUNTUALES (por id, email, código, `.single()`): identifican a una persona concreta.
// -------------------------------------------------------------------------------------------------------------------

function ficheros(dir, salida = []) {
  for (const nombre of readdirSync(join(raiz, dir))) {
    const rel = join(dir, nombre)
    const abs = join(raiz, rel)
    if (nombre === 'node_modules' || nombre === '.next') continue
    if (statSync(abs).isDirectory()) ficheros(rel, salida)
    else if (/\.(ts|tsx)$/.test(nombre)) salida.push(rel)
  }
  return salida
}

const PUNTUAL =
  /\.(eq|neq)\('id'|\.single\(|\.maybeSingle\(|\.in\('id'|\.eq\('email'|\.ilike\('email'|\.eq\('tracking_code'|\.ilike\('tracking_code'|\.eq\('calendly_email'|\.ilike\('calendly_email'|\.or\(`?'?email/
const ESCRITURA = /\.(insert|update|upsert|delete)\(/
const ACOTADO = /tenant_members|tenant_id|tenantId/

export function listadosSinAcotar(codigo) {
  const hallazgos = []
  for (const m of codigo.matchAll(/\.from\('users'\)/g)) {
    let ctx = codigo.slice(m.index, m.index + 700)
    const siguiente = ctx.indexOf('.from(', 12)
    if (siguiente > 0) ctx = ctx.slice(0, siguiente)
    if (ESCRITURA.test(ctx) || PUNTUAL.test(ctx) || ACOTADO.test(ctx)) continue
    hallazgos.push({ linea: codigo.slice(0, m.index).split('\n').length, ctx: ctx.replace(/\s+/g, ' ').slice(0, 110) })
  }
  return hallazgos
}

test('ningún listado de `users` queda sin acotar a una subcuenta (app, componentes y lib)', () => {
  const sueltos = []
  for (const dir of ['app', 'components', 'lib']) {
    for (const f of ficheros(dir)) {
      for (const h of listadosSinAcotar(readFileSync(join(raiz, f), 'utf8'))) {
        sueltos.push(`${relative(raiz, join(raiz, f))}:${h.linea}  ${h.ctx}`)
      }
    }
  }
  assert.deepEqual(
    sueltos,
    [],
    `Listados de users SIN acotar a la subcuenta (usa tenantUsersQuery de @/lib/users):\n  ${sueltos.join('\n  ')}`
  )
})

test('el detector distingue un listado suelto de uno acotado o puntual (el test no es vacuo)', () => {
  assert.equal(listadosSinAcotar("await sb.from('users').select('id, full_name').eq('is_active', true)").length, 1)
  assert.equal(listadosSinAcotar("await sb.from('users').select('*, roles(*)').order('full_name')").length, 1)
  assert.equal(listadosSinAcotar("await sb.from('users').select('id').eq('id', userId).single()").length, 0)
  assert.equal(listadosSinAcotar("await sb.from('users').update({ full_name: 'x' }).eq('id', x)").length, 0)
  assert.equal(listadosSinAcotar("await tenantUsersQuery(sb, tenantId, 'id').eq('is_active', true)").length, 0)
  assert.equal(listadosSinAcotar("await sb.from('users').select('id, tenant_members!inner(tenant_id)')").length, 0)
})

test('tenantUsersQuery: tenantId obligatorio y el filtro va en la propia consulta', () => {
  const src = leer('lib/users.ts')
  const fn = src.slice(
    src.indexOf('export function tenantUsersQuery'),
    src.indexOf('export function tenantUsersQuery') + 900
  )
  assert.match(fn, /tenantUsersQuery\(supabase: SupabaseClient, tenantId: string, columns: string\)/)
  assert.doesNotMatch(fn, /tenantId\?:/, 'tenantId no puede ser opcional')
  assert.match(fn, /tenant_members!inner\(tenant_id\)/)
  assert.match(fn, /\.eq\('tenant_members\.tenant_id', tenantId\)/)
})

test('la pantalla de Usuarios (la del fallo original) lista solo a la gente de SU subcuenta', () => {
  const page = leer('app/[tenant]/settings/users/page.tsx')
  assert.match(page, /tenantUsersQuery\(supabase, tenantId, '\*, roles\(\*\)'\)/)
  assert.doesNotMatch(page, /\.from\('users'\)\.select\('\*, roles\(\*\)'\)\.order/)
})

test('rutas de servidor con service-role: el equipo se acota en la consulta, no después en memoria', () => {
  const cron = leer('app/api/[tenant]/evergreen/cron/monthly/route.ts')
  assert.match(cron, /tenantUsersQuery\(sb, tenantId, 'id, full_name, base_salary'\)/)
  assert.doesNotMatch(cron, /memberIdSet/, 'no se cargan sueldos de otras subcuentas para filtrarlos luego')
  const futuras = leer('app/api/[tenant]/evergreen/commissions/future/route.ts')
  assert.match(futuras, /tenantUsersQuery\(\s*sb,\s*t\.tenantId,/)
})
