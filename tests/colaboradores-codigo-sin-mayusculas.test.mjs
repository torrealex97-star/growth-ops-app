import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { resolverColaboradorPorCodigo } from '../lib/collaborators/scope.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

// Incidente (octubre): el código de una colaboradora llegaba en minúsculas (`ab12cd34`) y el servidor lo comparaba
// con `.eq('code', …)` contra `AB12CD34`: ningún contacto nuevo se atribuía y ella no veía sus agendas.
// Placeholders neutros (Privacidad).

function sbFalso(perfiles) {
  const llamadas = []
  const consulta = {
    _filtros: {},
    select() {
      return this
    },
    eq(col, val) {
      llamadas.push(['eq', col, val])
      return this
    },
    ilike(col, patron) {
      llamadas.push(['ilike', col, patron])
      this._patron = patron
      return this
    },
    limit() {
      return this
    },
    then(resolver) {
      const buscado = this._patron.replace(/\\(.)/g, '$1').toLowerCase()
      resolver({ data: perfiles.filter((p) => p.code.toLowerCase() === buscado), error: null })
    },
  }
  return { sb: { from: () => Object.create(consulta) }, llamadas }
}

const PERFILES = [{ id: 'p1', code: 'AB12CD34' }]

test('el código en minúsculas resuelve al perfil (antes quedaba sin atribuir)', async () => {
  const { sb } = sbFalso(PERFILES)
  assert.deepEqual(await resolverColaboradorPorCodigo(sb, 't1', 'ab12cd34'), { id: 'p1' })
  assert.deepEqual(await resolverColaboradorPorCodigo(sb, 't1', '  AB12cd34 '), { id: 'p1' })
})

test('un código inexistente o vacío no resuelve a nadie', async () => {
  const { sb } = sbFalso(PERFILES)
  assert.equal(await resolverColaboradorPorCodigo(sb, 't1', 'zzzz'), null)
  assert.equal(await resolverColaboradorPorCodigo(sb, 't1', '   '), null)
})

test('los comodines de LIKE del código se escapan: «%» no resuelve a todos los perfiles', async () => {
  const { sb, llamadas } = sbFalso(PERFILES)
  assert.equal(await resolverColaboradorPorCodigo(sb, 't1', '%'), null)
  assert.equal(await resolverColaboradorPorCodigo(sb, 't1', 'AB_2CD34'), null)
  const patron = llamadas.filter((l) => l[0] === 'ilike').map((l) => l[2])
  assert.deepEqual(patron, ['\\%', 'AB\\_2CD34'])
})

test('dos perfiles que solo difieren en mayúsculas: gana el de coincidencia exacta; sin exacta no se adivina', async () => {
  const { sb } = sbFalso([
    { id: 'minus', code: 'abc' },
    { id: 'mayus', code: 'ABC' },
  ])
  assert.deepEqual(await resolverColaboradorPorCodigo(sb, 't1', 'ABC'), { id: 'mayus' })
  assert.deepEqual(await resolverColaboradorPorCodigo(sb, 't1', 'abc'), { id: 'minus' })
  assert.equal(await resolverColaboradorPorCodigo(sb, 't1', 'Abc'), null)
})

test('sigue acotado a la subcuenta y a perfiles ACTIVOS', async () => {
  const { sb, llamadas } = sbFalso(PERFILES)
  await resolverColaboradorPorCodigo(sb, 'tenant-x', 'ab12cd34')
  assert.ok(llamadas.some((l) => l[1] === 'tenant_id' && l[2] === 'tenant-x'))
  assert.ok(llamadas.some((l) => l[1] === 'status' && l[2] === 'active'))
})

test('el código fuente ya no compara el código con igualdad exacta', () => {
  const src = readFileSync(join(root, 'lib/collaborators/scope.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function resolverColaboradorPorCodigo'))
  assert.doesNotMatch(fn.slice(0, fn.indexOf('export async function contactIdsDeScope')), /\.eq\('code'/)
  assert.match(fn, /\.ilike\('code'/)
})
