import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  autoSourceFactura,
  autoSourceSueldo,
  camposDeFactura,
  construirGastoFactura,
  etiquetaMes,
  fechaIso,
  importeValido,
  mediaTypeDeArchivo,
  notaConversion,
  periodoValido,
  resolverImporte,
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
  assert.equal(fila.expense_date, '2026-11-01', 'factura de octubre = gasto de noviembre (mes de pago)')
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

test('el panel registra por la ruta de servidor (no escribe en commission_invoices desde el navegador); el importe es opcional', () => {
  const panel = leer('components/commissions/CommissionInvoicePanel.tsx')
  assert.match(panel, /\/evergreen\/commissions\/invoices/)
  assert.doesNotMatch(panel, /from\('commission_invoices'\)\.upsert/)
  assert.doesNotMatch(panel, /Indica el importe de tu factura/, 'ya no es obligatorio: lo lee la IA')
  assert.match(panel, /opcional/)
  assert.match(panel, /lo lee la IA/)
})

test('el dashboard del colaborador lleva el panel de facturas', () => {
  const dash = leer('components/collaborators/ColaboradorDashboard.tsx')
  assert.match(dash, /<CommissionInvoicePanel/)
})

// ── LECTURA CON IA: la factura del colaborador hace lo mismo que cuando se sube y analiza en Gastos ──

const EXTRACTO = {
  concept: 'Servicios de captación octubre',
  amount: 1149.42,
  currency: 'EUR',
  category: 'otros', // la IA podría clasificarla mal: se fuerza a comisiones
  counterparty: 'Emisora Demo SL',
  invoice_number: 'F-2026-0042',
  invoice_due_date: '2026-11-15',
  counterparty_tax_id: 'B12345678',
  counterparty_address: 'Calle Falsa 1, Madrid',
  counterparty_bank_account: 'ES0000000000000000000000',
  counterparty_bank_name: 'Banco Demo',
  expense_date: '2026-10-31',
  suggested_person: 'Otra Persona',
}
const periodoOct = periodoValido('2026-10', AHORA)
const rutaOk = `${T}/comisiones/${U}/2026-10-1.pdf`

test('el gasto con extracción usa los datos leídos de la factura (emisor, NIF, IBAN, nº, vencimiento, fecha)', () => {
  const g = construirGastoFactura({
    tenantId: T,
    userId: U,
    nombre: 'Persona Demo',
    periodo: periodoOct,
    amount: 1149.42,
    rutaFactura: rutaOk,
    extraido: EXTRACTO,
  })
  assert.equal(g.concept, 'Servicios de captación octubre')
  assert.equal(g.counterparty, 'Emisora Demo SL')
  assert.equal(g.subcategory, 'Emisora Demo SL')
  assert.equal(g.invoice_number, 'F-2026-0042')
  assert.equal(g.invoice_due_date, '2026-11-15')
  assert.equal(g.counterparty_tax_id, 'B12345678')
  assert.equal(g.counterparty_address, 'Calle Falsa 1, Madrid')
  assert.equal(g.counterparty_bank_account, 'ES0000000000000000000000')
  assert.equal(g.counterparty_bank_name, 'Banco Demo')
  assert.equal(g.expense_date, '2026-11-01', 'la fecha impresa (31 oct) no manda: cuenta el mes de pago')
  assert.deepEqual(g.ai_extracted, EXTRACTO, 'queda la instantánea de la extracción')
  assert.match(g.notes, /leída con IA/)
})

test('la IA NO decide la categoría ni la persona: siempre «comisiones» y quien sube (no el suggested_person)', () => {
  const g = construirGastoFactura({
    tenantId: T,
    userId: U,
    nombre: 'Persona Demo',
    periodo: periodoOct,
    amount: 10,
    rutaFactura: rutaOk,
    extraido: { ...EXTRACTO, category: 'otros', suggested_person: 'Otra Persona' },
  })
  assert.equal(g.category, 'comisiones', '`otros` entraría en el opex del P&L y duplicaría la comisión')
  assert.equal(g.person_id, U)
  assert.equal(g.status, 'pendiente')
  assert.equal(g.needs_review, true, 'la extracción es una sugerencia: revisión humana')
})

test('sin extracción (IA caída) el gasto se crea con lo mínimo y sin campos de identidad inventados', () => {
  const g = construirGastoFactura({
    tenantId: T,
    userId: U,
    nombre: 'Persona Demo',
    periodo: periodoOct,
    amount: 500,
    rutaFactura: rutaOk,
    extraido: null,
  })
  assert.equal(g.ai_extracted, null)
  assert.equal('invoice_number' in g, false)
  assert.equal('counterparty_bank_account' in g, false)
  assert.equal(g.expense_date, '2026-11-01')
  assert.match(g.notes, /Sin lectura de IA/)
})

test('una fecha extraída imposible (2026-02-31) no se usa', () => {
  assert.equal(fechaIso('2026-02-31'), null)
  assert.equal(fechaIso('2026-10-31'), '2026-10-31')
  assert.equal(fechaIso('31/10/2026'), null)
  const g = construirGastoFactura({
    tenantId: T,
    userId: U,
    nombre: 'P',
    periodo: periodoOct,
    amount: 1,
    rutaFactura: rutaOk,
    extraido: { expense_date: '2026-02-31', invoice_due_date: '2026-13-01' },
  })
  assert.equal(g.expense_date, '2026-11-01')
  assert.equal('invoice_due_date' in g, false)
})

test('el importe: manda la factura (ya en EUR); si la IA no lo leyó, el declarado; si discrepan, nota', () => {
  assert.deepEqual(resolverImporte({ amount: 100 }, null), { amount: 100, origen: 'factura', nota: null })
  assert.deepEqual(
    resolverImporte({ amount: 100 }, 100.5),
    { amount: 100, origen: 'factura', nota: null },
    '≤1 %: sin nota'
  )
  const dif = resolverImporte({ amount: 100 }, 150)
  assert.equal(dif.amount, 100)
  assert.match(dif.nota, /declarado .*150,00.*factura dice .*100,00/)
  assert.deepEqual(resolverImporte(null, 80), { amount: 80, origen: 'declarado', nota: null })
  assert.deepEqual(resolverImporte({ amount: null }, 80), { amount: 80, origen: 'declarado', nota: null })
  assert.equal(resolverImporte(null, null), null)
  assert.equal(resolverImporte({ amount: -5 }, null), null)
})

test('conversión de moneda: nota idéntica a la de Gastos', () => {
  const nota = notaConversion({ amount: 90.5, original_amount: 100, original_currency: 'USD', fx_rate: 0.905 })
  assert.equal(nota, 'Factura original en USD 100,00 · convertido a 90,50 € (tasa 0,9050)')
  assert.equal(notaConversion({ amount: 10 }), null)
  assert.equal(notaConversion(null), null)
})

test('formatos analizables: PDF e imágenes; el resto se registra sin IA', () => {
  assert.equal(mediaTypeDeArchivo('f.PDF'), 'application/pdf')
  assert.equal(mediaTypeDeArchivo('f.jpg'), 'image/jpeg')
  assert.equal(mediaTypeDeArchivo('f.jpeg'), 'image/jpeg')
  assert.equal(mediaTypeDeArchivo('f.png'), 'image/png')
  assert.equal(mediaTypeDeArchivo('f.webp'), 'image/webp')
  assert.equal(mediaTypeDeArchivo('f.heic'), null)
  assert.equal(mediaTypeDeArchivo('sinextension'), null)
})

test('camposDeFactura: solo vuelca lo que hay (para adjuntar a un gasto de sueldo ya existente)', () => {
  assert.deepEqual(camposDeFactura(null), {})
  const c = camposDeFactura({ invoice_number: ' F-1 ', counterparty_tax_id: '', invoice_due_date: '2026-11-15' })
  assert.equal(c.invoice_number, 'F-1')
  assert.equal(c.invoice_due_date, '2026-11-15')
  assert.equal('counterparty_tax_id' in c, false)
  assert.ok(c.ai_extracted)
})

test('Gastos y la factura del colaborador comparten UNA implementación del análisis con IA', () => {
  const gastos = leer('app/api/[tenant]/evergreen/ai/invoice/route.ts')
  const colab = leer('app/api/[tenant]/evergreen/commissions/invoices/route.ts')
  assert.match(gastos, /analizarFactura\(/)
  assert.match(colab, /analizarFactura\(/)
  assert.doesNotMatch(gastos, /extractInvoice\(/, 'la ruta de Gastos ya no duplica la lectura')
  const lib = leer('lib/ai/invoice-analysis.ts')
  assert.match(lib, /tenantAiEnv\(tenantId\)/, 'con la clave de IA de la subcuenta')
  assert.match(lib, /tenantActiveUserNames\(sb, tenantId\)/, 'solo el equipo de ESTA subcuenta')
  assert.match(lib, /convertToEur\(/, 'importe siempre en EUR')
  // la ruta de Gastos sigue siendo solo para finanzas
  assert.match(gastos, /\['admin', 'director', 'manager'\]/)
})

test('la ruta del colaborador: comprueba estados ANTES de gastar la IA y un fallo de IA no bloquea el registro', () => {
  const ruta = leer('app/api/[tenant]/evergreen/commissions/invoices/route.ts')
  const iaPos = ruta.indexOf('await leerConIa(')
  assert.ok(iaPos > 0)
  assert.ok(ruta.indexOf("'pagada'") < iaPos, 'una factura pagada se rechaza antes de llamar a la IA')
  assert.ok(ruta.indexOf("'pagado'") < iaPos, 'un gasto pagado se rechaza antes de llamar a la IA')
  assert.match(ruta, /catch \(e\)[\s\S]{0,160}extraido: null/, 'si la IA falla se sigue sin extracción')
  assert.match(ruta, /resolverImporte\(extraido, declarado\)/)
  assert.match(ruta, /status: 422/, 'sin importe (ni IA ni declarado) se pide a mano')
  assert.match(ruta, /maxDuration = 60/)
})

test('migración de Storage: facturas por carpeta (finanzas todo, el resto solo la suya) y contratos sin cambios', () => {
  const sql = leer('supabase/migrations/20261103130000_facturas_storage_por_carpeta.sql')
  for (const op of ['select', 'insert', 'update', 'delete'])
    assert.match(sql, new RegExp(`CREATE POLICY tenant_files_${op} ON storage\\.objects`), op)
  assert.match(sql, /get_my_role\(\) IN \('admin', 'director', 'manager'\)/, 'finanzas = igual que la RLS de expenses')
  assert.match(sql, /\(storage\.foldername\(name\)\)\[2\] = 'comisiones'/)
  assert.match(sql, /\(storage\.foldername\(name\)\)\[3\] = \(SELECT auth\.uid\(\)\)::text/)
  assert.match(sql, /bucket_id = 'contratos'/, 'contratos se conserva')
  // la ruta que sube el panel cuelga de <subcuenta>/comisiones/<persona>/, que es lo que exige la política
  assert.match(
    leer('components/commissions/CommissionInvoicePanel.tsx'),
    /`\$\{tenantId\}\/comisiones\/\$\{currentUserId\}\//
  )
})
