import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { construirGastoFactura, periodoValido } from '../lib/commissions/invoice-expense.ts'
import { porRevisarFueraDelPeriodo } from '../lib/finance/gastos-por-revisar.ts'
import { getPeriodRange } from '../lib/filters/period.ts'

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// Caso real: una colaboradora sube el día 9 la factura del MES EN CURSO. El gasto se fecha en su mes de pago
// (el siguiente), así que el filtro «Este mes» de Gastos lo escondía y nadie lo revisaba.
test('la factura del mes en curso nace con fecha del mes siguiente: fuera de «este mes»', () => {
  const hoy = new Date()
  const ym = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  const gasto = construirGastoFactura({
    tenantId: 't',
    userId: 'u',
    nombre: 'Persona',
    periodo: periodoValido(ym),
    amount: 330,
    rutaFactura: 't/comisiones/u/f.pdf',
  })
  assert.equal(gasto.needs_review, true)
  const esteMes = getPeriodRange('month', '', '')
  const fuera = porRevisarFueraDelPeriodo([gasto], esteMes)
  assert.equal(fuera.length, 1, 'sin esto la factura quedaba invisible para finanzas')
})

test('solo entra lo pendiente de revisar que el periodo NO muestra ya', () => {
  const rango = { from: new Date('2026-11-01T00:00:00+01:00'), to: new Date('2026-11-30T23:59:59+01:00') }
  const items = [
    { id: 'dentro', needs_review: true, expense_date: '2026-11-10' },
    { id: 'futura', needs_review: true, expense_date: '2026-12-01' },
    { id: 'antigua', needs_review: true, expense_date: '2026-09-15' },
    { id: 'confirmada', needs_review: false, expense_date: '2026-12-01' },
    { id: 'sin-marca', expense_date: '2026-12-01' },
  ]
  assert.deepEqual(
    porRevisarFueraDelPeriodo(items, rango).map((e) => e.id),
    ['futura', 'antigua']
  )
  assert.deepEqual(porRevisarFueraDelPeriodo(items, { from: null, to: null }), [], 'sin filtro ya se ve todo')
})

test('Gastos pinta esas filas marcadas y no las suma a los totales del periodo', () => {
  const p = leer('app/[tenant]/finanzas/gastos-facturas/gastos/page.tsx')
  assert.match(p, /porRevisarFueraDelPeriodo\(items, periodRange\)/)
  assert.match(p, /filasTabla\.map\(/)
  assert.match(p, /fuera del periodo/)
  assert.match(p, /computeTotals\(monthItems\)/, 'los totales siguen siendo solo los del periodo')
})
