import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { makeNavFilter, NAV_SECTIONS } from '../lib/nav.ts'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = (p) => readFileSync(join(raiz, p), 'utf8')

const visibles = (role) =>
  NAV_SECTIONS.filter((s) => s.dept === 'producto').flatMap((s) => s.items.filter(makeNavFilter(role)))

test('Feedback aparece en Alumnos para csm y liderazgo, y no para ventas ni marketing', () => {
  for (const r of ['csm', 'admin', 'director', 'manager'])
    assert.ok(
      visibles(r).some((i) => i.href === '/students/feedback'),
      r
    )
  for (const r of ['setter', 'closer', 'marketing', 'cobros'])
    assert.ok(!visibles(r).some((i) => i.href === '/students/feedback'), r)
})

test('las 3 pestañas de Feedback tienen página real', () => {
  for (const p of ['page.tsx', 'profesores/page.tsx', 'respuestas/page.tsx', 'layout.tsx']) {
    assert.ok(leer(`app/[tenant]/students/feedback/${p}`).length > 200, p)
  }
})

test('csm solo ve formularios de feedback de alumnos (API y, en la migración, la BD)', () => {
  const admin = leer('lib/forms/admin.ts')
  assert.match(admin, /role !== 'csm'\) return null/)
  assert.match(admin, /audience === 'alumnos'/)
  for (const f of ['[id]/route.ts', '[id]/responses/route.ts', '[id]/analytics/route.ts']) {
    assert.match(leer(`app/api/[tenant]/evergreen/forms/${f}`), /denyIfNotVisible\(/, f)
  }
  assert.match(
    leer('app/api/[tenant]/evergreen/forms/route.ts'),
    /auth\.role === 'csm'\) listQuery = listQuery\.eq\('audience', 'alumnos'\)/
  )
  const mig = leer('supabase/migrations/20261020120000_forms_csm_solo_alumnos.sql')
  for (const t of ['forms', 'form_responses', 'form_sessions', 'form_versions'])
    assert.match(mig, new RegExp(`on public\\.${t} for select`))
  assert.equal((mig.match(/audience = 'alumnos'/g) || []).length, 4)
})

test('el feedback agregado va acotado al tenant, con ventana, tope y solo columnas necesarias', () => {
  const r = leer('app/api/[tenant]/evergreen/forms/feedback/route.ts')
  assert.match(r, /MAX_ROWS = 5000/)
  assert.match(r, /eq\('audience', 'alumnos'\)/)
  assert.doesNotMatch(r, /select\('\*'\)/)
  const n = (r.match(/\.eq\('tenant_id', auth\.tenantId\)/g) || []).length
  assert.ok(n >= 3, `consultas acotadas: ${n}`)
})

test('Alumnos › Respuestas lista todos los formularios que el rol puede ver, agrupados por audiencia', () => {
  const p = leer('app/[tenant]/students/feedback/respuestas/page.tsx')
  for (const a of ['alumnos', 'cualificacion', 'captacion', 'empleados']) assert.ok(p.includes(a), a)
  assert.match(p, /<optgroup/)
})
