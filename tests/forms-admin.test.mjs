import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { makeNavFilter, NAV_SECTIONS } from '../lib/nav.ts'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = (p) => readFileSync(join(raiz, p), 'utf8')
const API = 'app/api/[tenant]/evergreen/forms'

test('Formularios aparece en Marketing para admin y marketing, y no para roles de ventas', () => {
  const visible = (role) =>
    NAV_SECTIONS.filter((s) => s.dept === 'marketing')
      .flatMap((s) => s.items.filter(makeNavFilter(role)))
      .some((i) => i.href === '/marketing/formularios')
  assert.equal(visible('admin'), true)
  assert.equal(visible('marketing'), true)
  assert.equal(visible('setter'), false)
  assert.equal(visible('closer'), false)
})

test('las dos pestañas del hub tienen página real', () => {
  for (const p of [
    'page.tsx',
    'plantillas/page.tsx',
    '[id]/page.tsx',
    '[id]/constructor/page.tsx',
    '[id]/compartir/page.tsx',
    'layout.tsx',
    '[id]/layout.tsx',
  ]) {
    assert.ok(readFileSync(join(raiz, 'app/[tenant]/marketing/formularios', p), 'utf8').length > 50, p)
  }
})

test('la API de administración exige sesión y rol; las escrituras solo admin/director/marketing', () => {
  const admin = leer('lib/forms/admin.ts')
  assert.match(admin, /requireTenant\(tenant\)/)
  assert.match(admin, /WRITE_ROLES = \['admin', 'director', 'marketing'\]/)
  for (const f of ['route.ts', '[id]/route.ts', '[id]/publish/route.ts']) {
    assert.match(leer(`${API}/${f}`), /authorizeForms\(tenant, (true|false)\)/, f)
  }
  assert.match(leer(`${API}/route.ts`), /authorizeForms\(tenant, true\)/)
})

test('toda consulta de administración va acotada al tenant', () => {
  for (const f of ['route.ts', '[id]/route.ts', '[id]/publish/route.ts']) {
    const src = leer(`${API}/${f}`)
    const consultas = (src.match(/\.from\('(forms|form_versions|form_responses|form_sessions)'\)/g) || []).length
    const acotadas = (src.match(/\.eq\('tenant_id', auth\.tenantId\)|tenant_id: auth\.tenantId/g) || []).length
    assert.ok(acotadas >= consultas, `${f}: ${consultas} consultas, ${acotadas} acotadas`)
  }
})

test('publicar crea una versión nueva inmutable y valida antes', () => {
  const src = leer(`${API}/[id]/publish/route.ts`)
  assert.match(src, /validateConfig\(/)
  assert.match(src, /formConfigSchema\.safeParse/)
  assert.match(src, /version = \(last\?\.version \?\? 0\) \+ 1/)
  assert.match(src, /from\('form_versions'\)[\s\S]*\.insert\(/)
})

test('guardar el borrador nunca publica por la puerta de atrás', () => {
  assert.match(leer(`${API}/[id]/route.ts`), /b\.status === 'published'[\s\S]*Usa Publicar/)
})
