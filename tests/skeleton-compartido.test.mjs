import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Un solo componente de carga: así el cambio de color de acento, el modo oscuro y la animación son
// idénticos en todas las pantallas. Los `<div className="… animate-pulse" />` sueltos se desviaban uno a uno.
function ficheros(dir, salida = []) {
  for (const f of readdirSync(dir)) {
    const ruta = join(dir, f)
    if (statSync(ruta).isDirectory()) ficheros(ruta, salida)
    else if (ruta.endsWith('.tsx')) salida.push(ruta)
  }
  return salida
}

test('ninguna pantalla pinta un hueco de carga con un div animate-pulse suelto: usa <Skeleton />', () => {
  const infractores = []
  for (const f of [...ficheros('app'), ...ficheros('components')]) {
    if (f.endsWith('components/ui/skeleton.tsx')) continue
    const src = readFileSync(f, 'utf8')
    if (/<div(?:\s+key=\{[^}]+\})?\s+className="[^"]*\banimate-pulse\b[^"]*"\s*\/>/.test(src)) infractores.push(f)
  }
  assert.deepEqual(infractores, [])
})

test('los ficheros que usan <Skeleton /> lo importan del componente compartido', () => {
  for (const f of [...ficheros('app'), ...ficheros('components')]) {
    const src = readFileSync(f, 'utf8')
    if (/<Skeleton[\s/>]/.test(src) && !f.endsWith('components/ui/skeleton.tsx')) {
      assert.match(src, /from '@\/components\/ui\/skeleton'/, f)
    }
  }
})
