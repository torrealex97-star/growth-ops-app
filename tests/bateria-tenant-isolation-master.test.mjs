// BATERÍA ADVERSARIAL TRANSVERSAL DE TENANT ISOLATION — PR-1 master (T-5 del inventario).
//
// Los 10 escenarios atacan la barrera entre subcuentas desde el lado del atacante, ejercitando
// CADA INVARIANTE/PRUEBA YA EXISTENTE por módulo (consolidación, NO duplicación: la lógica
// canónica de cada guarda sigue viviendo en su módulo; la batería re-ejecuta las guardas para que
// una regresión en CUALQUIER módulo rompa también aquí). Mapa completo y procedimiento live en
// `docs/TENANT_ISOLATION_BATTERY.md`.
//
//   E1  SQL-MCP: escritura/ofuscación rechazada por la barrera read-only     → lib/mcp/sql-executor.ts + migr. 20261010140000
//   E2  Cash cross-tenant: la dedup por payment_reference es                → lib/canonical/cash.ts + consumidores
//       per-tenant; si el caller no filtrara, mezclaría dinero de dos fuentes
//   E3  Webhook-IDs-coincidentes (Fathom): determinista con prueba,         → lib/fathom/match.ts + migr. 20260913130000
//       cola de revisión humana cuando hay duda; UNIQUE por (tenant, meeting)
//   E4  attribution_funnel_for_tenant filtra las 4 tablas por tenant        → migr. 20260914170000/180000 (canónica: tests/atribucion-aislamiento)
//   E5  RPC de colaboradores no ejecutable sin sesión (REVOKE)              → migr. 20261001162712 (P0 cerrado 01-oct)
//   E6  Barrido de fugas service-role con saneamiento y control             → scripts/auditoria-tenant-queries.mjs (canónica: tests/fase3)
//   E7  Esquema: lista ÚNICA de excepciones sin tenant_id con motivo        → lib/seguridad/invariante-tenant.ts (canónica: tests/esquema-tenant-invariante)
//   E8  Storage: buckets privados y objetos bajo `<tenant_id>/`             → migr. 20260913100000 + barrido de app/
//   E9  Agente IA: tenant cerrado server-side (nunca del body)              → ruta del agent + lib/ai/agent/tools.ts
//   E10 Sonda live A/B anclada y protegida (requiere confirmación)          → scripts/qa/rls-multitenant.mjs
//
// La batería NO reemplaza a las suites canónicas ni a la sonda live (`npm run test:rls:live`:
// credenciales + RLS_LIVE_CONFIRM=1); las señala y las re-ejecuta en el nivel que corre en CI.

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Módulos canónicos que la batería ejercita (nunca duplica).
import { EXCEPCIONES_SIN_TENANT } from '../lib/seguridad/invariante-tenant.ts'
import { esConsultaSoloLectura, ejecutarSqlMcp } from '../lib/mcp/sql-executor.ts'
import { canonicalCash } from '../lib/canonical/cash.ts'
import { decideMatch } from '../lib/fathom/match.ts'
import { escanear } from '../scripts/auditoria-tenant-queries.mjs'

const raizProyecto = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(raizProyecto, p), 'utf8')

const sesionMcp = { userId: 'u1', email: 'qa-bateria@example.test', clientId: 'bateria' }

test('E1 · MCP — la barrera de SQL libre no deja escalar a escritura ni se burla con ofuscación', () => {
  // Atacante: escritura directa, vía CTE, cambio de claims/sesión, DO anónimo, COPY a disco y
  // escalada de permisos con GRANT. TODAS se rechazan aquí (la garantía real es la transacción
  // READ ONLY + rol mcp_reader; esta es la primera barrera y su mensaje accionable).
  for (const ataque of [
    'select 1; delete from contacts where 1=1',
    'with x as (insert into contacts values (1) returning *) select * from x',
    'select set_config(\'request.jwt.claims\', \'{"sub":"otro"}\', true)',
    'do $$ begin update contacts set full_name = null; end $$',
    "copy contacts to '/tmp/dump.csv'",
    'grant select on sales to anon',
  ]) {
    assert.equal(esConsultaSoloLectura(ataque), false, `debió rechazar: ${ataque}`)
  }
  // Un SELECT/WITH legítimo sigue pasando: la barrera no sobre-bloquea el uso normal.
  assert.equal(esConsultaSoloLectura("select * from contacts where tenant_id = 'x'"), true)
  assert.equal(esConsultaSoloLectura('with c as (select 1) select * from c'), true)

  // El ejecutor inyecta los claims del sub REAL del usuario (viene de la conexión, no del body)
  // y baja al rol lector dentro de la transacción + READ ONLY + timeout.
  const ejecutor = leer('lib/mcp/sql-executor.ts')
  assert.match(ejecutor, /set local role mcp_reader/)
  assert.match(ejecutor, /transaction_read_only = on/)
  assert.match(ejecutor, /statement_timeout/)
  assert.match(ejecutor, /request\.jwt\.claims/)

  // La ruta MCP autentica por Bearer: el identificador de usuario nunca viene del body.
  const ruta = leer('app/api/mcp/route.ts')
  assert.match(ruta, /autenticar\(/)
  assert.doesNotMatch(ruta, /userId[^\n]*body/)

  // La whitelist de GRANT SELECT se coteja contra el catálogo vivo y aborta si deriva (no calla).
  assert.match(
    leer('supabase/migrations/20261010140000_mcp_reader_grants_sync_catalog.sql'),
    /RAISE EXCEPTION 'whitelist con tablas ausentes/
  )
})

test('E1b · MCP — degenera fail-closed ANTES de tocar red', async (t) => {
  // Consulta vacía y demasiado larga se rechazan sin crear el cliente (ni conexión ni timeout).
  const vacia = await ejecutarSqlMcp('   ', sesionMcp)
  assert.equal(vacia.ok, false)
  assert.doesNotMatch(vacia.error, /sql|postgres/i)
  const larga = await ejecutarSqlMcp('select ' + '1'.repeat(25_000), sesionMcp)
  assert.equal(larga.ok, false)
  assert.match(larga.error, /demasiado larga/)

  // Consulta válida sin POSTGRES_URL: error accionable en vez de fingir resultados.
  if (process.env.POSTGRES_URL) return t.skip('POSTGRES_URL presente en el entorno: no tocamos esa base')
  const sinUrl = await ejecutarSqlMcp('select 1', sesionMcp)
  assert.equal(sinUrl.ok, false)
  assert.match(sinUrl.error, /POSTGRES_URL/)
})

test('E2 · Cash — la dedup por payment_reference es per-tenant y los consumidores filtran', () => {
  // La MISMA referencia externa (pay_dup) existe en dos subcuentas: cada llamada aislada devuelve
  // SU importe exacto — el motor es puro y sin estado global, así que la única puerta de mezcla
  // es un caller que no filtre; las guardas de esos callers van justo debajo.
  const a = canonicalCash(
    [{ payment_id: 'pay_dup', charge_id: null, amount: 100, refunded_amount: 0, status: 'succeeded' }],
    [],
    []
  )
  assert.equal(a.net, 100)
  assert.equal(a.duplicatedPayments, 0)
  const b = canonicalCash(
    [],
    [{ id: 'c1', payment_reference: 'pay_dup', gross_amount: 100, status: 'collected', collected_at: '2026-10-01' }]
  )
  assert.equal(b.net, 100)
  assert.equal(b.bySource.internal, 100)
  assert.equal(b.duplicatedPayments, 0)

  // Guarda del caller (1): el consumidor canónico filtra por tenant en todas sus consultas.
  const consulta = leer('lib/metrics/consulta.ts')
  const eqConsulta = (consulta.match(/\.eq\('tenant_id', tenantId\)/g) || []).length
  assert.ok(eqConsulta >= 4, `consulta.ts con solo ${eqConsulta} filtros por tenant`)

  // Guarda del caller (2): la pantalla que mezcla Stripe+collections acota ambas por tenant.
  const unit = leer('app/[tenant]/unit-economics/page.tsx')
  const eqUnit = (unit.match(/\.eq\('tenant_id', tenantId\)/g) || []).length
  assert.ok(eqUnit >= 5, `unit-economics con solo ${eqUnit} filtros por tenant`)

  // Guarda estructural: el espejo Stripe es UNIQUE por (tenant_id, payment_id) — el origen mismo
  // de la primaria no puede colisionar entre subcuentas.
  assert.match(
    leer('supabase/migrations/20260918170000_stripe_payments_mirror.sql'),
    /UNIQUE \(tenant_id, payment_id\)/
  )
})

test('E3 · Webhook-IDs-coincidentes (Fathom) — determinista con prueba, cola con duda', () => {
  const ahora = '2026-10-13T10:00:00Z'

  // 1) El id estable de la reunión decide PRIMERO: ya estampada ⇒ esa cita y nada más.
  const estampada = decideMatch({ fathomMeetingId: 'frm_1', startedAt: ahora, email: 'p@example.test' }, [
    { id: 'cA', appointmentDatetime: '2026-10-13T10:40:00Z', fathomMeetingId: 'frm_1' },
  ])
  assert.equal(estampada.kind, 'ya_importada')
  assert.equal(estampada.appointmentId, 'cA')

  // 2) Dos candidatas igual de cercanas: NO se elige — el «escribir en todas» que corrompía la
  //    cola con la misma llamada en N citas volvió a pasar, y no vuelve a pasar.
  const ambigua = decideMatch({ fathomMeetingId: null, startedAt: ahora, email: 'p@example.test' }, [
    { id: 'c1', appointmentDatetime: '2026-10-13T10:10:00Z' },
    { id: 'c2', appointmentDatetime: '2026-10-13T10:20:00Z' },
  ])
  assert.equal(ambigua.kind, 'ambigua')
  assert.deepEqual(ambigua.candidateIds, ['c1', 'c2'])

  // 3) Un solo candidato claramente el más cercano: emparejamiento determinista por email_y_hora.
  const unica = decideMatch({ fathomMeetingId: null, startedAt: ahora, email: 'p@example.test' }, [
    { id: 'c3', appointmentDatetime: '2026-10-13T10:30:00Z' },
  ])
  assert.equal(unica.kind, 'match')
  assert.equal(unica.appointmentId, 'c3')

  // Guarda estructural: la cola es idempotente POR (tenant_id, fathom_meeting_id) — un id externo
  // repetido en dos subcuentas no colisiona porque cada tenant tiene su fila.
  assert.match(
    leer('supabase/migrations/20260913130000_fathom_match_review.sql'),
    /fathom_match_review_tenant_meeting_key[\s\S]*?ON public\.fathom_match_review\(tenant_id, fathom_meeting_id\)/
  )
})

test('E4 · attribution_funnel_for_tenant — invoker, membership server-side, 4 tablas filtradas', () => {
  const base = leer('supabase/migrations/20260914170000_attribution_funnel_tenant_scope.sql')
  assert.match(base, /STABLE SECURITY INVOKER/)
  assert.doesNotMatch(base.replace(/^--.*$/gm, ''), /SECURITY DEFINER/)
  assert.match(base, /SET search_path TO 'public'/)

  const expandir = leer('supabase/migrations/20260914180000_attribution_funnel_active_tenant.sql')
  const ejecutable = expandir
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('--'))
    .join('\n')
  assert.match(ejecutable, /attribution_funnel_for_tenant\(p_tenant_id UUID\)/)
  for (const [tabla, filtro] of [
    ['contact_attributions', /t\.tenant_id = ca\.tenant_id/],
    ['contacts', /t\.tenant_id = c\.tenant_id/],
    ['appointments', /a\.tenant_id = p_tenant_id/],
    ['sales', /s\.tenant_id = p_tenant_id/],
  ]) {
    assert.match(ejecutable, new RegExp(`public\\.${tabla}`), `falta la tabla ${tabla}`)
    assert.match(ejecutable, filtro, `la tabla ${tabla} no filtra por tenant`)
  }
  // La subcuenta pedida se negocia server-side: ∈ auth_tenant_ids() del usuario o super_admin.
  assert.match(ejecutable, /p_tenant_id IN \(SELECT public\.auth_tenant_ids\(\)\) OR public\.is_super_admin\(\)/)
  assert.match(expandir, /REVOKE ALL ON FUNCTION public\.attribution_funnel_for_tenant\(UUID\) FROM PUBLIC, anon;/)
})

test('E5 · Colaboradores — el RPC que era explotable sin sesión sigue revocado y la ruta acota ids', () => {
  const revoke = leer('supabase/migrations/20261001162712_revoke_collaborator_ghl_backfill_execute.sql')
  assert.match(revoke, /REVOKE EXECUTE ON FUNCTION public\.attribute_ghl_contacts_for_collaborator/)
  assert.match(revoke, /FROM PUBLIC, anon, authenticated/)

  // La administración de atribución exige pertenencia y solo acepta contactos DE ESTA subcuenta.
  const ruta = leer('app/api/[tenant]/evergreen/colaboradores/attribution/route.ts')
  assert.match(ruta, /no se aceptan ids cross-tenant/)
  assert.match(ruta, /requireTenant/)
})

test('E6 · Barrido service-role — el escáner corre con saneo y sin candidatos', () => {
  // La lógica canónica vive en `scripts/auditoria-tenant-queries.mjs` (canónica: tests/fase3);
  // la batería RE-EJECUTA el escáner para entrada consolidada, con su mismo saneamiento.
  const { resumen, candidatos } = escanear()
  assert.ok(resumen.rutasService >= 100, `rutas service-role sospechosamente pocas (${resumen.rutasService})`)
  assert.ok(
    resumen.queriesServiceRevisadas >= 400,
    `queries revisadas sospechosamente pocas (${resumen.queriesServiceRevisadas})`
  )
  assert.deepEqual(
    candidatos,
    [],
    `candidatos a fuga cross-tenant (revisar y filtrar, o justificarlo en el escáner):
  ${candidatos.map((c) => `${c.fichero}:${c.linea}`).join('\n  ')}`
  )
})

test('E7 · Esquema — la lista de excepciones sin tenant_id es única y cada entrada motivada', () => {
  const entradas = Object.entries(EXCEPCIONES_SIN_TENANT)
  assert.ok(entradas.length >= 7, `lista de excepciones sospechosamente corta (${entradas.length})`)
  for (const [tabla, motivo] of entradas) {
    assert.ok(typeof motivo === 'string' && motivo.trim().length > 10, `${tabla} está en la lista sin motivo real`)
  }
  // Cada clase de excepción cerrada sigue declarada: raíz, plataforma, OAuth MCP (scope de usuario).
  for (const tabla of ['tenants', 'resource_links', 'mcp_oauth_clients', 'mcp_oauth_tokens']) {
    assert.ok(EXCEPCIONES_SIN_TENANT[tabla], `la excepción cerrada ${tabla} dejó de estar declarada`)
  }
  // Y la suite canónica NO mantiene copia propia del listado: vive una sola vez (la lib).
  assert.match(leer('tests/esquema-tenant-invariante.test.mjs'), /from '\.\.\/lib\/seguridad\/invariante-tenant\.ts'/)
})

test('E8 · Storage — buckets privados por migración y ninguna ruta de app toca storage.buckets', () => {
  const storage = leer('supabase/migrations/20260913100000_storage_tenant_policies.sql')
  assert.match(storage, /ON CONFLICT \(id\) DO UPDATE SET public = false/)
  assert.match(storage, /'contratos', 'contratos', false/)
  assert.match(storage, /'facturas', 'facturas', false/)
  // 4 políticas (select/insert/update/delete) = 5 predicados: la UPDATE lleva USING y WITH CHECK.
  const predicados = (
    storage.match(/\(storage\.foldername\(name\)\)\[1\] IN \(SELECT public\.auth_tenant_ids\(\)::text\)/g) || []
  ).length
  assert.equal(predicados, 5, `esperaba 5 predicados aislados en 4 políticas, hay ${predicados}`)

  // El vector HTTP que forzaba los buckets a públicos fue retirado: nada de app/ toca storage.buckets.
  assert.deepEqual(
    barrer(join(raizProyecto, 'app'), ['.ts', '.tsx'], /storage\.buckets/),
    [],
    'hay ficheros en app/ que vuelven a tocar storage.buckets — revisar y justificar'
  )
})

test('E9 · Agente IA — tenant cerrado server-side, nunca del body y sin service-role', () => {
  const ruta = leer('app/api/[tenant]/evergreen/ai/agent/route.ts')
  assert.match(ruta, /await requireTenant\(tenant\)/)
  assert.match(ruta, /tenant_id: auth\.tenantId/)
  assert.doesNotMatch(ruta, /SERVICE_ROLE|service_role/)

  // Las tools de negocio reciben el tenant fijo en ToolContext (resuelto por requireTenant en el
  // servidor): ninguna query del agente toma el tenant de un parámetro externo.
  const tools = leer('lib/ai/agent/tools.ts')
  assert.match(tools, /ToolContext = \{[\s\S]*?tenantId/)
  const eqTenant = (tools.match(/\.eq\('tenant_id', tenantId\)/g) || []).length
  assert.ok(eqTenant >= 2, `tools.ts con solo ${eqTenant} filtros por tenant`)
})

test('E10 · Sonda live A/B — anclada al repo y protegida contra ejecución accidental', () => {
  const sonda = leer('scripts/qa/rls-multitenant.mjs')
  assert.match(sonda, /RLS_LIVE_CONFIRM !== '1'/)
  assert.match(sonda, /INSERT cross-tenant debe ser rechazado por RLS/)
  const pkg = JSON.parse(leer('package.json'))
  assert.ok(pkg.scripts['test:rls:live'], 'el script live dejó de estar registrado en package.json')
})

// ─── helper de barrido (E8): ficheros debajo de `dir` cuyo contenido casa el patrón ──────────
function barrer(dir, exts, patron) {
  const coincidencias = []
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre)
    if (statSync(ruta).isDirectory()) {
      coincidencias.push(...barrer(ruta, exts, patron))
      continue
    }
    if (!exts.some((ext) => nombre.endsWith(ext))) continue
    if (patron.test(readFileSync(ruta, 'utf8'))) coincidencias.push(ruta)
  }
  return coincidencias
}
