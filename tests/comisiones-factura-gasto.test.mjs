import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  autoSourceFactura,
  autoSourceSueldo,
  construirGastoFactura,
  etiquetaMes,
  importeValido,
  periodoValido,
  rutaFacturaValida,
} from '../lib/commissions/invoice-expense.ts'
import { computeMonthlyPnl } from '../lib/finance/pnl.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

// FACTURA DEL COLABORADOR → GASTO. El colaborador no puede escribir en `expenses` (RLS), así que la ruta de
// servidor valida con estas funciones. Placeholders neutros (Privacidad): ninguna persona ni subcuenta real.

const T = '11111111-1111-4111-8111-111111111111'
const U = '22222222-2222-4222-8222-222222222222'
const OTRO = '33333333-3333-4333-8333-333333333333'
const AHORA = new Date(2026, 10, 15) // nov-2026

test('el mes acepta YYYY-MM y YYYY-MM-DD y se normaliza al día 1', () => {
  assert.deepEqual(periodoValido('2026-10', AHORA), { periodMonth: '2026-10-01', ym: '2026-10' })
  assert.deepEqual(periodoValido('2026-10-01', AHORA), { periodMonth: '2026-10-01', ym: '2026-10' })
  assert.deepEqual(periodoValido('2026-10-17', AHORA), { periodMonth: '2026-10-01', ym: '2026-10' })
})

test('el mes rechaza basura, meses inexistentes, futuro lejano y pasado remoto', () => {
  for (const malo of [null, undefined, 7, '', 'octubre', '2026-13', '2026-00', '26-10', '2026/10'])
    assert.equal(periodoValido(malo, AHORA), null, String(malo))
  assert.ok(periodoValido('2026-12', AHORA), 'el mes siguiente sí')
  assert.equal(periodoValido('2027-01', AHORA), null, 'dos meses por delante, no')
  assert.ok(periodoValido('2024-11', AHORA), 'hace 24 meses, límite')
  assert.equal(periodoValido('2024-10', AHORA), null, 'más de 24 meses atrás, no')
})

test('el importe: positivo, finito, con 2 decimales y coma decimal', () => {
  assert.equal(importeValido(1551.98), 1551.98)
  assert.equal(importeValido('1551,98'), 1551.98)
  assert.equal(importeValido('12.345'), 12.35)
  assert.equal(importeValido(0.004), 0)
})

test('el importe rechaza cero, negativos, NaN, vacío y cifras absurdas', () => {
  for (const malo of [0, -5, '-1', NaN, Infinity, '', 'abc', null, undefined, 1_000_001, {}])
    assert.equal(importeValido(malo), null, String(malo))
})

test('la ruta del archivo tiene que colgar de SU carpeta: no se registra la factura de otra persona ni subcuenta', () => {
  assert.equal(rutaFacturaValida(`${T}/comisiones/${U}/2026-10-1700000000.pdf`, T, U), true)
  assert.equal(rutaFacturaValida(`${T}/comisiones/${OTRO}/2026-10-1.pdf`, T, U), false, 'otra persona')
  assert.equal(rutaFacturaValida(`${OTRO}/comisiones/${U}/2026-10-1.pdf`, T, U), false, 'otra subcuenta')
  assert.equal(rutaFacturaValida(`${T}/gastos/${U}/2026-10-1.pdf`, T, U), false, 'otra carpeta')
  assert.equal(rutaFacturaValida(`${T}/comisiones/${U}/../${OTRO}/x.pdf`, T, U), false, 'salto de carpeta')
  assert.equal(rutaFacturaValida(`${T}/comisiones/${U}/sub/x.pdf`, T, U), false, 'subcarpeta')
  assert.equal(rutaFacturaValida(`${T}/comisiones/${U}/`, T, U), false, 'sin archivo')
  assert.equal(rutaFacturaValida(`${T}/comisiones/${U}/a\\b.pdf`, T, U), false)
  for (const malo of [null, undefined, 3, '', 'x'.repeat(301)]) assert.equal(rutaFacturaValida(malo, T, U), false)
})

test('auto_source lleva subcuenta y persona (el índice único de expenses es global) y no choca con el sueldo', () => {
  assert.equal(autoSourceFactura(T, U), `commission_invoice:${T}:${U}`)
  assert.equal(autoSourceSueldo(U), `salary:${U}`)
  assert.notEqual(autoSourceFactura(T, U), autoSourceSueldo(U))
  assert.notEqual(autoSourceFactura(T, U), autoSourceFactura(T, OTRO))
})

test('el gasto que se crea: comisiones, pendiente, a revisar, con la factura adjunta y firmado por la persona', () => {
  const periodo = periodoValido('2026-10', AHORA)
  const fila = construirGastoFactura({
    tenantId: T,
    userId: U,
    nombre: '  Persona Demo ',
    periodo,
    amount: 1234.5,
    rutaFactura: `${T}/comisiones/${U}/2026-10-1.pdf`,
  })
  assert.equal(fila.category, 'comisiones')
  assert.equal(fila.status, 'pendiente')
  assert.equal(fila.needs_review, true, 'el importe lo declara la persona: finanzas debe contrastarlo')
  assert.equal(fila.amount, 1234.5)
  assert.equal(fila.period, '2026-10')
  assert.equal(fila.expense_date, '2026-10-01')
  assert.equal(fila.person_id, U)
  assert.equal(fila.created_by, U)
  assert.equal(fila.tenant_id, T)
  assert.equal(fila.auto_source, autoSourceFactura(T, U))
  assert.equal(fila.invoice_url, `${T}/comisiones/${U}/2026-10-1.pdf`)
  assert.equal(fila.concept, 'Factura de comisiones · Persona Demo · octubre 2026')
  assert.equal(fila.recurring, false)
})

test('sin nombre legible el concepto no queda con un hueco', () => {
  const fila = construirGastoFactura({
    tenantId: T,
    userId: U,
    nombre: '   ',
    periodo: periodoValido('2026-10', AHORA),
    amount: 10,
    rutaFactura: `${T}/comisiones/${U}/a.pdf`,
  })
  assert.match(fila.concept, /Colaborador/)
})

test('etiquetaMes en castellano', () => {
  assert.equal(etiquetaMes('2026-01'), 'enero 2026')
  assert.equal(etiquetaMes('2026-12'), 'diciembre 2026')
})

test('NO DUPLICA el coste en el P&L: un gasto de categoría «comisiones» no entra en el opex (las comisiones salen del libro)', () => {
  const base = { sales: [], collections: [], refunds: [], commissions: [] }
  const gasto = (category) => [{ amount: 500, category, expense_date: '2026-10-01' }]
  const sinGasto = computeMonthlyPnl('2026-10', { ...base, expenses: [] })
  const conFactura = computeMonthlyPnl('2026-10', { ...base, expenses: gasto('comisiones') })
  assert.equal(conFactura.totalOpex, sinGasto.totalOpex)
  assert.equal(conFactura.preTaxProfit, sinGasto.preTaxProfit)
  // Control: una categoría que SÍ cuenta mueve el opex, así que el test detecta si el P&L cambiara de criterio.
  assert.equal(computeMonthlyPnl('2026-10', { ...base, expenses: gasto('sueldos') }).totalOpex, 500)
})

test('la ruta registra con la clave de servicio, solo para la propia persona y acotada por subcuenta', () => {
  const ruta = leer('app/api/[tenant]/evergreen/commissions/invoices/route.ts')
  assert.match(ruta, /requireTenant\(tenant\)/)
  assert.match(ruta, /SUPABASE_SERVICE_ROLE_KEY/)
  // nunca se acepta un user_id ni un tenant_id del cliente
  assert.doesNotMatch(ruta, /body\??\.(userId|user_id|tenantId|tenant_id)/)
  assert.match(ruta, /rutaFacturaValida\(path, auth\.tenantId, auth\.userId\)/)
  assert.match(ruta, /pays_commissions/, 'D9: quien no comisiona no factura comisiones')
  // lo ya pagado no se pisa en silencio
  assert.match(ruta, /'pagada'/)
  assert.match(ruta, /'pagado'/)
  // con sueldo fijo se adjunta al gasto automático, no se crea otro
  assert.match(ruta, /autoSourceSueldo\(auth\.userId\)/)
  // cada escritura sobre expenses va acotada por tenant
  const escrituras = ruta.match(/\.from\('expenses'\)[\s\S]{0,260}?\.eq\('tenant_id'/g) ?? []
  assert.ok(escrituras.length >= 2, 'las escrituras sobre expenses deben llevar tenant_id')
})

test('el panel registra por la ruta de servidor (no escribe en commission_invoices desde el navegador) y exige importe', () => {
  const panel = leer('components/commissions/CommissionInvoicePanel.tsx')
  assert.match(panel, /\/evergreen\/commissions\/invoices/)
  assert.doesNotMatch(panel, /from\('commission_invoices'\)\.upsert/)
  assert.match(panel, /Indica el importe de tu factura/)
})

test('el dashboard del colaborador lleva el panel de facturas', () => {
  const dash = leer('components/collaborators/ColaboradorDashboard.tsx')
  assert.match(dash, /<CommissionInvoicePanel/)
})
