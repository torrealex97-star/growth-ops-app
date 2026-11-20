import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raiz = join(import.meta.dirname, '..')
const leer = (r) => readFileSync(join(raiz, r), 'utf8')

test('cold calling: repartir manda el lanzamiento que se está viendo', () => {
  const page = leer('app/[tenant]/cold-calling/page.tsx')
  assert.match(page, /accion: 'repartir', callerId: caller\.callerId, launch: data\?\.launch\?\.id/)
})

test('cold calling: un fallo de recarga no borra un panel ya cargado', () => {
  const page = leer('app/[tenant]/cold-calling/page.tsx')
  assert.match(page, /if \(error && !data\) \{/)
  assert.match(page, /No se pudo actualizar el panel/)
})

test('feedback: vincular no deja el diálogo bloqueado si falla la red', () => {
  const page = leer('app/[tenant]/students/feedback/page.tsx')
  const fn = page.slice(page.indexOf('const vincular'), page.indexOf('const vincular') + 1200)
  assert.match(fn, /try \{/)
  assert.match(fn, /finally \{\s*setGuardando\(''\)/)
})

test('feedback: solo se vincula una respuesta huérfana y no se puede desvincular', () => {
  const route = leer('app/api/[tenant]/evergreen/forms/[id]/responses/[rid]/route.ts')
  assert.doesNotMatch(route, /contact_id: z\.string\(\)\.uuid\(\)\.nullable\(\)/)
  assert.match(route, /consulta = consulta\.is\('contact_id', null\)/)
  assert.match(route, /status: 409/)
})

test('feedback: recargar conserva lo que hay en pantalla', () => {
  const hook = leer('components/forms/useFeedback.ts')
  assert.match(hook, /if \(clave\.current !== k\)/)
})
