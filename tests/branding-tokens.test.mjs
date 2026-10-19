import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// BRANDING: el color de acento cambia por subcuenta (`data-accent` reescribe --brand-* y --primary). Un
// `cyan-*` o un hex fijo no cambia con ella y deja un trozo de la pantalla con otra marca.
function ficheros(dir, salida = []) {
  for (const f of readdirSync(dir)) {
    const ruta = join(dir, f)
    if (statSync(ruta).isDirectory()) ficheros(ruta, salida)
    else if (ruta.endsWith('.tsx')) salida.push(ruta)
  }
  return salida
}

test('ninguna pantalla usa clases cyan-*: el acento sale de los tokens brand-*', () => {
  const infractores = [...ficheros('app'), ...ficheros('components')].filter((f) =>
    /\bcyan-\d+/.test(readFileSync(f, 'utf8'))
  )
  assert.deepEqual(infractores, [])
})

test('las gráficas de ventas y finanzas pintan con el token de marca, no con un hex fijo', () => {
  for (const f of ['components/os/SalesChart.tsx', 'components/finanzas/FinanceCharts.tsx']) {
    const src = readFileSync(f, 'utf8')
    assert.ok(!/#34d399/i.test(src), `${f}: hex fijo`)
    assert.match(src, /hsl\(var\(--brand-400\)\)/)
  }
})
