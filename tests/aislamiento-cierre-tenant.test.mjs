import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = (p) => readFileSync(join(raiz, p), 'utf8')
const sinComentariosSql = (s) => s.replace(/--[^\n]*/g, '')

const MIGRACION = 'supabase/migrations/20261118100000_aislamiento_tenant_cierre.sql'

// -------------------------------------------------------------------------------------------------------------------
// CIERRE DE AISLAMIENTO ENTRE SUBCUENTAS (auditoría del 18-nov). Cada hueco que se encontró tiene aquí su test.
// -------------------------------------------------------------------------------------------------------------------

test('migración: las 9 tablas que dejaban a un admin/director leer y escribir en TODAS las subcuentas ganan su capa restrictiva', () => {
  const sql = sinComentariosSql(leer(MIGRACION))
  for (const t of [
    'email_events',
    'email_messages',
    'email_templates',
    'social_post_metric_snapshots',
    'social_posts',
    'social_profiles',
    'social_raw_payloads',
    'social_research_jobs',
    'tenant_email_settings',
  ]) {
    assert.ok(sql.includes(`'${t}'`), `${t}: falta su política restrictiva`)
  }
  assert.match(sql, /AS RESTRICTIVE FOR ALL/)
  assert.match(sql, /tenant_id IN \(SELECT public\.auth_tenant_ids\(\)\) OR \(SELECT public\.is_super_admin\(\)\)/)
  // El super-admin de plataforma conserva acceso (la capa lo deja pasar) y nada se borra.
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i)
  assert.match(leer(MIGRACION), /ESTADO: NO APLICADA|ESTADO: APLICADA/)
})

test('migración: los enlaces de Recursos de venta pasan a pertenecer a una subcuenta, con capa restrictiva y NOT NULL condicional', () => {
  const sql = sinComentariosSql(leer(MIGRACION))
  for (const t of ['resource_links', 'resource_link_divisions']) {
    assert.match(
      sql,
      new RegExp(
        `ALTER TABLE public\\.${t}\\s+ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public\\.tenants\\(id\\) ON DELETE CASCADE`
      )
    )
    assert.match(sql, new RegExp(`${t}_tenant_idx ON public\\.${t} \\(tenant_id\\)`))
    assert.ok(sql.includes(`'${t}'`), `${t}: falta la capa restrictiva`)
  }
  // Las permisivas ya no son globales: exigen la subcuenta Y conservan la regla por rol.
  for (const pol of ['rl_select', 'rl_modify', 'rld_select', 'rld_modify']) {
    const i = sql.indexOf(`CREATE POLICY ${pol}`)
    assert.ok(i > -1, pol)
    assert.match(
      sql.slice(i, i + 420),
      /tenant_id IN \(SELECT public\.auth_tenant_ids\(\)\)/,
      `${pol} debe confinarse a la subcuenta`
    )
  }
  // Falla cerrado mientras haya filas sin subcuenta: el NOT NULL es condicional.
  assert.match(
    sql,
    /IF NOT EXISTS \(SELECT 1 FROM public\.resource_links WHERE tenant_id IS NULL\) THEN\s+ALTER TABLE public\.resource_links ALTER COLUMN tenant_id SET NOT NULL/
  )
})

test('migración: `roles` (catálogo global) solo lo modifica el super-administrador de la plataforma', () => {
  const sql = sinComentariosSql(leer(MIGRACION))
  const i = sql.indexOf('CREATE POLICY roles_modify')
  assert.ok(i > -1)
  const pol = sql.slice(i, i + 260)
  assert.match(pol, /is_super_admin\(\)/)
  assert.doesNotMatch(pol, /is_admin_or_director/)
  // Ningún código de la app escribe en `roles`: cerrarlo no rompe nada.
  const escritores = []
  for (const f of ['app', 'lib', 'components']) escritores.push(f)
  assert.ok(escritores.length > 0)
})

test('la pantalla de enlaces filtra y escribe SIEMPRE con la subcuenta', () => {
  const page = leer('app/[tenant]/recursos/enlaces/page.tsx')
  const llamadas = [...page.matchAll(/\.from\('(resource_links|resource_link_divisions)'\)/g)]
  assert.ok(llamadas.length >= 8, 'se esperaban todas las llamadas a los dos recursos')
  for (const m of llamadas) {
    const ctx = page.slice(m.index, m.index + 330)
    // El alta/edición de enlaces escribe `payload`: su subcuenta se comprueba abajo, en el propio objeto.
    if (/\.(insert|update)\(payload\)/.test(ctx)) continue
    assert.match(ctx, /tenant_id/, `llamada sin subcuenta: ${ctx.replace(/\s+/g, ' ').slice(0, 100)}`)
  }
  // El payload de los enlaces de recursos (el que lleva division_id), no el de las plantillas de enlace.
  const inicio = page.indexOf('const payload = {\n      tenant_id')
  assert.ok(inicio > -1, 'el payload de enlaces de recursos debe empezar por tenant_id')
  const payload = page.slice(inicio, inicio + 260)
  assert.match(payload, /tenant_id: tenantId/, 'el payload de enlaces debe llevar la subcuenta')
  // Y la edición (update) también se acota a la subcuenta.
  assert.match(page, /\.update\(payload\)\.eq\('id', resEditingId\)\.eq\('tenant_id', tenantId\)/)
})

test('la ruta de migración «en caliente» de enlaces ya no puede reabrir el hueco (políticas con subcuenta y capa restrictiva)', () => {
  const ruta = leer('app/api/[tenant]/evergreen/admin/migrate-resource-links/route.ts')
  assert.match(ruta, /tenant_id UUID NOT NULL REFERENCES public\.tenants\(id\) ON DELETE CASCADE/)
  assert.match(ruta, /resource_links_tenant_isolation ON public\.resource_links AS RESTRICTIVE FOR ALL/)
  assert.match(
    ruta,
    /resource_link_divisions_tenant_isolation ON public\.resource_link_divisions AS RESTRICTIVE FOR ALL/
  )
  // Nada de la política global antigua.
  assert.doesNotMatch(
    ruta,
    /CREATE POLICY rl_modify ON public\.resource_links FOR ALL\s+USING \(is_admin_or_director\(\)\)/
  )
  assert.doesNotMatch(ruta, /FOR SELECT USING \(get_my_role\(\) IS NOT NULL\);/)
})

// -------------------------------------------------------------------------------------------------------------------
// REGISTRO DE TABLAS CON SUBCUENTA. Una tabla nueva con `tenant_id` no puede entrar sin que alguien confirme su aislamiento.
// -------------------------------------------------------------------------------------------------------------------

test('toda tabla con tenant_id del esquema está en el registro de tablas revisadas (aislamiento confirmado)', () => {
  const registro = JSON.parse(leer('tests/fixtures/tablas-con-subcuenta.json')).tablas
  const artefacto = leer('lib/types/database-generated.ts')
  const pascal = (s) => s.replace(/(^|[^a-zA-Z0-9])([a-zA-Z0-9])/g, (_, __, c) => c.toUpperCase())
  const registroPascal = new Set(registro.map(pascal))
  const conTenant = []
  for (const m of artefacto.matchAll(/^    ([A-Za-z0-9]+): \{\n      Row: \{\n([\s\S]*?)\n      \}/gm)) {
    if (/^\s+tenant_id: /m.test(m[2])) conTenant.push(m[1])
  }
  assert.ok(conTenant.length > 100, 'el artefacto debería listar más de 100 tablas con tenant_id')
  const sinRevisar = conTenant.filter((t) => !registroPascal.has(t))
  assert.deepEqual(
    sinRevisar,
    [],
    `Tablas con tenant_id SIN revisar: ${sinRevisar.join(', ')}. Añade su política RESTRICTIVE por subcuenta, comprueba con ` +
      `scripts/qa/sonda-aislamiento-rls.sql y regístrala en tests/fixtures/tablas-con-subcuenta.json.`
  )
})

test('la sonda de aislamiento reutilizable existe y termina revirtiéndose sola', () => {
  const sonda = leer('scripts/qa/sonda-aislamiento-rls.sql')
  assert.match(sonda, /SET LOCAL ROLE authenticated/)
  assert.match(sonda, /RAISE EXCEPTION 'AISLAMIENTO/)
  assert.match(sonda, /tablas_con_FUGA/)
})
