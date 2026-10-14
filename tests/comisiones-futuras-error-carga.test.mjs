import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { interpretarRespuestaFuturas } from '../lib/commissions/future-response.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

// S1 §6.8 P1 (corregido 14-oct) — EL FALLO DE CARGA DE /commissions/future NO SE DISIMULA
// COMO «CERO COMISIONES POR COBRAR».
//
// Los tres consumidores hacían `const rows = d?.rows ?? []`: el 500 llega por el MISMO
// .then((r) => r.json()), su cuerpo { error } no lleva `rows`, y el fallo de red caía en el
// `.catch` que devolvía []. Resultado en pantalla: «Comisiones futuras: 0 EUR — no hay nada
// por cobrar» con el look de certeza de siempre, cuando en realidad la fuente era ilegible.
// Es la variante de cliente de «un hueco no es un cero» (regla #272): el hueco se declara
// VISIBLE con detalle y reintentar; una cantidad falsa, nunca.
//
// Congela el contrato dividido en el helper canónico:
//   · { ok: true, rows, ... } con 200 → { rows }.
//   · { error } con 500 (o respuesta ilegible) → { error }, un estado DISTINTO de vacío.
// Y que cada consumidor interprete por el helper y pinte el aviso con reintentar.

const CONSUMIDORES = [
  'app/[tenant]/dashboard/page.tsx',
  'app/[tenant]/comisiones/page.tsx',
  'components/collaborators/ColaboradorDashboard.tsx',
]

test('respuesta ok con filas se interpreta como filas', () => {
  const r = interpretarRespuestaFuturas({ ok: true, rows: [{ userId: 'u1', amount: 100 }] })
  assert.deepEqual(r, { rows: [{ userId: 'u1', amount: 100 }] })
})

test('el cuerpo del 500 { error } NO parece un array vacío: es un error distinto', () => {
  const r = interpretarRespuestaFuturas({ error: 'boom' })
  assert.deepEqual(r, { error: 'boom' })
})

test('una respuesta vacía/rota (json() falló → null) también declara el hueco', () => {
  assert.deepEqual(interpretarRespuestaFuturas(null), { error: 'respuesta ilegible del servidor' })
  assert.deepEqual(interpretarRespuestaFuturas(undefined), { error: 'respuesta ilegible del servidor' })
  assert.deepEqual(interpretarRespuestaFuturas({}), { error: 'respuesta ilegible del servidor' })
  // ok:true SIN rows legibles no se cuela como vacío: es ilegible.
  assert.deepEqual(interpretarRespuestaFuturas({ ok: true }), { error: 'respuesta ilegible del servidor' })
  assert.deepEqual(interpretarRespuestaFuturas({ ok: true, rows: 'no-array' }), {
    error: 'respuesta ilegible del servidor',
  })
})

test('los tres consumidores interpretan por el helper único (no cada uno su copia)', () => {
  for (const pantalla of CONSUMIDORES) {
    const src = leer(pantalla)
    assert.match(src, /interpretarRespuestaFuturas/, `${pantalla}: debe usar lib/commissions/future-response`)
  }
  // Y nadie vuelve a mirar solo `d?.rows` del json de la ruta future: el patrón que codificaba
  // el 500 como vacío. (Los .rows de superagregados SQL son otros, se excluyen.)
  for (const pantalla of CONSUMIDORES) {
    const src = leer(pantalla)
    assert.ok(
      !/(const\s+\w*(rows|Rows)\w*\s*=\s*\w+\?\.rows)/.test(src),
      `${pantalla}: volvió el patrón d?.rows que disimula el 500 como vacío`
    )
  }
})

test('ningún consumidor traga el fallo con catch vacío del fetch de future', () => {
  for (const pantalla of CONSUMIDORES) {
    const src = leer(pantalla)
    assert.ok(!/catch\s*\(\)\s*=>\s*\[\]/.test(src), `${pantalla}: catch → [] disimula el fallo como vacío`)
    assert.ok(!/catch\s*\{\s*\}/.test(src), `${pantalla}: hay un catch {} que se traga un error`)
  }
})

test('el aviso de fuente ilegible se pinta con reintentar (hueco visible, no cero falso)', () => {
  for (const pantalla of CONSUMIDORES) {
    const src = leer(pantalla)
    assert.match(src, /(futurasError|errorFuturas|futureError)/, `${pantalla}: no guarda el estado de error de future`)
    assert.match(src, /\{(futurasError|errorFuturas|futureError)/, `${pantalla}: el error no llega a pintarse`)
    assert.match(src, /Reintentar/, `${pantalla}: sin salida para quien lo ve`)
  }
})
