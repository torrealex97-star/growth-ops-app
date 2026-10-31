import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')
const PAGE = 'app/[tenant]/marketing/afiliados/afiliados/page.tsx'

// PETICIÓN 31-oct: en la ficha del colaborador se ve «la comisión completa» pero no
// se aclara cuánto procede de cash collected DE ESTE MES y cuánto de MESES ANTERIORES.

test('el panel lee el enlace canónico del ledger: commissions.collection_id + collections.id/collected_at', () => {
  const page = read(PAGE)
  // Cada fila del ledger nace de un cobro del motor (UNIQUE (collection_id, user_id,
  // participant_type)): el desglose no reinstenta fórmulas, viaja por el FK real.
  // Se valida por bloque .from() para no depender de cómo Prettier parte la línea.
  const bloqueDe = (tabla) => {
    const inicio = page.indexOf(`.from('${tabla}')`)
    assert.ok(inicio >= 0, `debe leer ${tabla}`)
    return page.slice(inicio, page.indexOf(".from('", inicio + 1))
  }
  assert.match(bloqueDe('commissions'), /collection_id/)
  assert.match(bloqueDe('collections'), /id, sale_id, gross_amount, status, collected_at/)
})

test('el desglose tiene bucket propio para lo sin cash y no reparte «por si acaso»', () => {
  const page = read(PAGE)
  // Un hueco no es un cero y no se decide a dedo: filas SIN collection vigente
  // (cuota futura sin cobrar, clawback por devolución, ajuste) NO se cuelgan del
  // mes del cash: caen en sinCashVinculado.
  const sinCobro = page.indexOf('if (!fechaCobro) desglose.sinCashVinculado += importe')
  const esteMes = page.indexOf('inPeriod(fechaCobro, rangoMesEnCurso)')
  assert.ok(sinCobro > 0 && esteMes > sinCobro, 'debe particionar: sin cash → bucket propio; con cash → mes(es)')
  // El mes natural en curso sale del rango canónico del filtro 'month', no de new Date() a mano.
  assert.match(page, /getPeriodRange\('month', '', ''\)/)
})

test('la ficha muestra el desglose completo con sus etiquetas honestas', () => {
  const page = read(PAGE)
  assert.match(page, /Comisión completa \(ledger\)/)
  assert.match(page, /Comisiones de cash de este mes/)
  assert.match(page, /Comisiones de cash de meses anteriores/)
  // Cuota futura/devolución/ajuste se declara, no se funde con el cash cobrado.
  assert.match(page, /cuotas futuras, devoluciones y ajustes/)
  // Los signos del ledger se consumen: clawback (direction negative) resta también en el desglose.
  assert.match(page, /direction === 'negative' \? -1 : 1/)
  // Prop obligatorio en FichaColaborador (ficha propia del colaborador y detalle admin).
  assert.match(page, /desglose=\{desgloseComisionesDe\(/)
})
