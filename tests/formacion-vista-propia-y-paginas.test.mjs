import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const raiz = join(import.meta.dirname, '..')
const leer = (r) => readFileSync(join(raiz, r), 'utf8')

test('formación: un administrador ve por defecto solo la formación de su rol; todo solo en modo gestionar', () => {
  const api = leer('app/api/[tenant]/evergreen/formacion/route.ts')
  assert.match(api, /const gestionar = t\.administraTenant && req\.nextUrl\.searchParams\.get\('gestionar'\) === '1'/)
  assert.match(api, /if \(!gestionar \|\| resumen\) \{/)
  assert.doesNotMatch(
    api,
    /if \(!t\.administraTenant \|\| resumen\)/,
    'administrar ya no abre todos los cursos por sí solo'
  )
})

test('formación: los controles de edición dependen del modo gestionar, no solo de administrar', () => {
  const page = leer('app/[tenant]/formacion/page.tsx')
  assert.match(page, /const editando = datos\.puedeEditar && gestionar/)
  assert.match(page, /gestionar \? `\$\{base\}\?gestionar=1` : base/)
  assert.match(page, /Gestionar formación del equipo/)
})

test('toda entrada del menú de cold calling tiene su página (no hay 404)', () => {
  assert.ok(existsSync(join(raiz, 'app/[tenant]/cold-calling/page.tsx')), '/cold-calling necesita page.tsx')
  assert.ok(existsSync(join(raiz, 'app/[tenant]/llamadas/page.tsx')), '/llamadas necesita page.tsx')
})
