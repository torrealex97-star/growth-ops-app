import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { escaparLike, patronContiene, sinSintaxisOr } from '../lib/search/like.ts'

test('los comodines de LIKE se buscan como texto literal', () => {
  assert.equal(escaparLike('a_b'), 'a\\_b')
  assert.equal(escaparLike('100%'), '100\\%')
  assert.equal(escaparLike('a\\b'), 'a\\\\b')
  assert.equal(patronContiene('a_b'), '%a\\_b%')
})

test('lo que rompe la sintaxis de or() de PostgREST se quita en vez de reventar la búsqueda', () => {
  assert.equal(sinSintaxisOr('Gómez, Laura'), 'Gómez Laura')
  assert.equal(sinSintaxisOr('a(b)"c"'), 'a b c')
  assert.equal(patronContiene('Gómez, Laura'), '%Gómez Laura%')
})

test('un texto sin nada buscable no genera patrón (nunca un «%%» que lo encuentra todo)', () => {
  assert.equal(patronContiene(''), null)
  assert.equal(patronContiene('  ,() "" '), null)
})

test('la búsqueda global, el buscador de cobros y Typeform usan el helper y no un patrón a mano', () => {
  for (const f of [
    'components/os/GlobalSearch.tsx',
    'app/api/[tenant]/evergreen/sales/payment-inbox/route.ts',
    'lib/typeform/entrada.ts',
  ]) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /@\/lib\/search\/like/, f)
  }
  const g = readFileSync('components/os/GlobalSearch.tsx', 'utf8')
  assert.ok(!/ilike\.%\$\{q\}%/.test(g), 'sin patrón sin escapar en la búsqueda global')
})

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function fuentes(dir, salida = []) {
  for (const f of readdirSync(dir)) {
    const ruta = join(dir, f)
    if (statSync(ruta).isDirectory()) fuentes(ruta, salida)
    else if (/\.(ts|tsx)$/.test(ruta)) salida.push(ruta)
  }
  return salida
}

test('ninguna búsqueda del código monta a mano un patrón ilike con texto de la persona', () => {
  const infractores = []
  for (const f of [...fuentes('app'), ...fuentes('components'), ...fuentes('lib')]) {
    if (f.endsWith('lib/search/like.ts')) continue
    const src = readFileSync(f, 'utf8')
    // `.ilike.%${x}%` o `.ilike('col', `%${x}%`)` con una variable: debe pasar por patronContiene.
    if (/ilike\.%\$\{(?!digits)/.test(src) || /\.ilike\([^)]*`%\$\{/.test(src)) infractores.push(f)
  }
  assert.deepEqual(infractores, [])
})
