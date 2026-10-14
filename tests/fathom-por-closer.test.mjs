import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { estadoPublico, SIN_CONEXION } from '../lib/fathom/conexion-personal.ts'

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('el estado público nunca incluye la clave y distingue conectada de error', () => {
  const c = {
    id: 'x',
    tenant_id: 't',
    user_id: 'u',
    api_key: 'enc:secreto',
    status: 'conectada',
    last_sync_at: '2026-10-14T10:00:00Z',
    last_error: null,
    meetings_seen: 7,
  }
  const e = estadoPublico(c)
  assert.equal(e.conectada, true)
  assert.equal(e.reunionesVistas, 7)
  assert.equal(JSON.stringify(e).includes('secreto'), false)
  assert.equal(estadoPublico({ ...c, status: 'error', last_error: 'x' }).conectada, false)
  assert.deepEqual(estadoPublico(null), SIN_CONEXION)
})

test('la API solo opera sobre el usuario de la sesión y nunca devuelve la clave', () => {
  const r = leer('app/api/[tenant]/evergreen/fathom/mi-conexion/route.ts')
  assert.match(r, /requireTenant\(tenant\)/)
  assert.match(r, /t\.userId/)
  assert.doesNotMatch(r, /body\.(userId|user_id)/)
  assert.doesNotMatch(r, /api_key/)
})

test('la clave se guarda cifrada y el cron exige CRON_SECRET', () => {
  const l = leer('lib/fathom/conexion-personal.ts')
  assert.match(l, /api_key: encryptSecret\(clave\)/)
  assert.match(l, /procesarMeetingFathom\(sb, conexion\.tenant_id, meeting,/)
  const c = leer('app/api/[tenant]/evergreen/cron/fathom-closers/route.ts')
  assert.match(c, /Bearer \$\{process\.env\.CRON_SECRET\}/)
  assert.ok(existsWorkflow())
})

function existsWorkflow() {
  return /fathom-closers/.test(leer('.github/workflows/cron-fathom-closers.yml'))
}

test('la migración deja la tabla sin grants externos y con aislamiento por subcuenta', () => {
  const m = leer('supabase/migrations/20261014160000_user_fathom_connections.sql')
  assert.match(m, /REVOKE ALL ON public\.user_fathom_connections FROM PUBLIC, anon, authenticated/)
  assert.match(m, /AS RESTRICTIVE/)
  assert.match(m, /UNIQUE \(tenant_id, user_id\)/)
})

test('el botón «Mi Fathom» está en Agendas junto al calendario personal', () => {
  const p = leer('app/[tenant]/crm/agendas/page.tsx')
  assert.match(p, /<FathomPersonalSettings tenant=\{tenant\} \/>/)
})

test('una reunión que falla no tumba la conexión; el contador solo suma lo que entra', () => {
  const l = leer('lib/fathom/conexion-personal.ts')
  assert.match(l, /resumen\.fallidas\+\+/)
  assert.match(l, /meetings_seen: conexion\.meetings_seen \+ resumen\.nuevas \+ resumen\.enRevision/)
  assert.doesNotMatch(l, /meetings_seen: conexion\.meetings_seen \+ resumen\.vistas/)
})

test('la clave personal no encola reuniones sin cita candidata (PII ajena)', () => {
  assert.match(leer('lib/fathom/conexion-personal.ts'), /\{ omitirSinCandidatos: true \}/)
  const i = leer('lib/fathom/ingesta.ts')
  assert.match(i, /opts\.omitirSinCandidatos && decision\.kind !== 'ambigua' && candidates\.length === 0/)
  assert.ok(
    i.indexOf('opts.omitirSinCandidatos &&') <
      i.indexOf(
        'await anotarRevision(sb, tenantId, fathomMeetingId, meeting, email, startedAt, {\n      kind: decision.kind'
      )
  )
})

test('la lectura de citas de Calendly va en trozos de 40 y los ajustes cachean el fallo', () => {
  const c = leer('lib/integrations/citas-sync.ts')
  assert.match(c, /i \+= 40/)
  assert.match(c, /uris\.slice\(i, i \+ 40\)/)
  const s = leer('lib/platform/settings.ts')
  assert.match(s, /fallo: true/)
  assert.match(s, /cache\.fallo \? null : cache\.filas/)
})
