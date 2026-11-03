import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { fechaDeImputacion } from '../lib/commissions/imputacion.ts'
import { buildTeamCommissionSummary } from '../lib/commissions/dashboard.ts'
import { construirResumenMensual } from '../lib/commissions/mensual.ts'
import { computeMonthlyPnl } from '../lib/finance/pnl.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

// UN LIBRO, VARIAS PANTALLAS. Las comisiones se muestran en Comisiones, Colaboradores, P&L, Resumen, Finanzas, el
// dashboard y Mi día. Cada una mide por una fecha distinta A PROPÓSITO (pago / cobro), pero tienen que ser el MISMO
// dinero visto desde dos fechas, no dos cifras que se contradicen. Placeholders neutros (Privacidad).

const AHORA = new Date(2026, 10, 15)

const cobro = (id, collected) => ({
  id,
  sale_id: `s-${id}`,
  gross_amount: 1000,
  processing_fee: 0,
  collected_at: collected,
  status: 'collected',
})

const fila = (o) => ({
  id: o.id,
  sale_id: o.sale ?? `s-${o.col}`,
  collection_id: o.col ?? null,
  user_id: 'u1',
  participant_type: 'collaborator',
  commission_amount: o.amount,
  direction: o.dir ?? 'positive',
  status: o.status ?? 'approved',
  liquidation_month: o.liq,
  created_at: o.creada ?? '2026-11-02T10:00:00Z',
  users: { full_name: 'Persona Demo', pays_commissions: true },
  sales: { contacts: { full_name: 'Cliente' } },
  collections: o.col ? { collected_at: o.cobro } : null,
})

test('fechaDeImputacion: el cobro manda; devoluciones y ajustes a su mes de liquidación; la creación es el último recurso', () => {
  const m = new Map([['c1', '2026-10-05T09:00:00Z']])
  assert.equal(
    fechaDeImputacion({ collection_id: 'c1', liquidation_month: '2026-11-01', created_at: '2026-11-02' }, m),
    '2026-10-05T09:00:00Z'
  )
  assert.equal(
    fechaDeImputacion({ direction: 'negative', collection_id: 'c1', liquidation_month: '2026-11-01' }, m),
    '2026-11-01'
  )
  assert.equal(
    fechaDeImputacion({ collection_id: null, liquidation_month: '2026-11-01', created_at: '2026-11-03' }, m),
    '2026-11-01'
  )
  assert.equal(
    fechaDeImputacion({ collection_id: 'x', liquidation_month: null, created_at: '2026-11-03' }, m),
    '2026-11-03'
  )
  assert.equal(fechaDeImputacion({ collection_id: null }, m), null)
})

test('una fila RECREADA por una reparación (creada en noviembre, cobro de agosto) cuenta en AGOSTO, no en noviembre', () => {
  const m = new Map([['c-ago', '2026-08-20T10:00:00Z']])
  const f = { collection_id: 'c-ago', liquidation_month: '2026-09-01', created_at: '2026-11-02T08:00:00Z' }
  assert.equal(fechaDeImputacion(f, m).slice(0, 7), '2026-08')
  assert.notEqual(f.created_at.slice(0, 7), fechaDeImputacion(f, m).slice(0, 7), 'created_at habría dicho noviembre')
})

test('MISMO DINERO, DOS FECHAS: lo que Comisiones dice que se paga en noviembre = lo que el P&L imputa a octubre (cobro)', () => {
  const comisiones = [
    fila({ id: 'a', col: 'c1', cobro: '2026-10-03T10:00:00Z', liq: '2026-11-01', amount: 100 }),
    fila({ id: 'b', col: 'c2', cobro: '2026-10-20T10:00:00Z', liq: '2026-11-01', amount: 250.5, status: 'pending' }),
  ]
  const colecciones = [cobro('c1', '2026-10-03T10:00:00Z'), cobro('c2', '2026-10-20T10:00:00Z')]
  const nov = construirResumenMensual(comisiones, [], comisiones, AHORA).find((m) => m.month === '2026-11')
  const pnlOct = computeMonthlyPnl('2026-10', {
    sales: [],
    collections: colecciones,
    refunds: [],
    expenses: [],
    commissions: comisiones.map((c) => ({
      commission_amount: c.commission_amount,
      direction: c.direction,
      collection_id: c.collection_id,
      liquidation_month: c.liquidation_month,
      status: c.status,
    })),
  })
  assert.equal(nov.total, 350.5)
  assert.equal(pnlOct.comisiones, nov.total, 'Comisiones (mes de pago) y P&L (mes del cobro) cuentan el mismo dinero')
  // y el P&L de noviembre NO las vuelve a contar
  const pnlNov = computeMonthlyPnl('2026-11', {
    sales: [],
    collections: colecciones,
    refunds: [],
    expenses: [],
    commissions: comisiones.map((c) => ({
      commission_amount: c.commission_amount,
      direction: c.direction,
      collection_id: c.collection_id,
      liquidation_month: c.liquidation_month,
      status: c.status,
    })),
  })
  assert.equal(pnlNov.comisiones, 0)
})

test('las CANCELADAS no son coste: ni en Comisiones ni en el P&L (p. ej. un ajuste manual sustituye una fila)', () => {
  const comisiones = [
    fila({ id: 'a', col: 'c1', cobro: '2026-10-03T10:00:00Z', liq: '2026-11-01', amount: 100 }),
    fila({ id: 'x', col: 'c1', cobro: '2026-10-03T10:00:00Z', liq: '2026-11-01', amount: 999, status: 'cancelled' }),
  ]
  const nov = construirResumenMensual(comisiones, [], comisiones, AHORA).find((m) => m.month === '2026-11')
  assert.equal(nov.total, 100)
  const pnl = computeMonthlyPnl('2026-10', {
    sales: [],
    collections: [cobro('c1', '2026-10-03T10:00:00Z')],
    refunds: [],
    expenses: [],
    commissions: comisiones.map((c) => ({
      commission_amount: c.commission_amount,
      direction: c.direction,
      collection_id: c.collection_id,
      liquidation_month: c.liquidation_month,
      status: c.status,
    })),
  })
  assert.equal(pnl.comisiones, 100)
})

test('un AJUSTE sin cobro vinculado cae en el MISMO mes en Comisiones y en el P&L (su mes de liquidación)', () => {
  const ajuste = fila({ id: 'adj', col: null, liq: '2026-11-01', amount: 6.91, status: 'pending' })
  const nov = construirResumenMensual([ajuste], [], [ajuste], AHORA).find((m) => m.month === '2026-11')
  assert.equal(nov.total, 6.91)
  const pnl = computeMonthlyPnl('2026-11', {
    sales: [],
    collections: [],
    refunds: [],
    expenses: [],
    commissions: [
      {
        commission_amount: 6.91,
        direction: 'positive',
        collection_id: null,
        liquidation_month: '2026-11-01',
        status: 'pending',
      },
    ],
  })
  assert.equal(pnl.comisiones, 6.91)
})

test('Colaboradores mide la comisión del periodo por la fecha del COBRO (como su cash y el P&L), no por created_at', () => {
  const pag = leer('app/[tenant]/marketing/afiliados/afiliados/page.tsx')
  assert.match(pag, /fechaDeImputacion\(c, fechaCobroPorId\)/)
  assert.doesNotMatch(pag, /inPeriod\(c\.created_at, rango\)/, 'created_at no es una fecha de negocio')
  assert.match(pag, /liquidation_month, collection_id/, 'trae el mes de liquidación para los ajustes sin cobro')
})

test('todas las pantallas que SUMAN comisiones descartan las canceladas', () => {
  const dash = leer('app/[tenant]/dashboard/page.tsx')
  assert.equal((dash.match(/c\.status === 'liquidated' \|\| c\.status === 'cancelled'/g) ?? []).length, 2)
  assert.match(leer('lib/finance/pnl.ts'), /c\.status !== 'cancelled' && includes\(commissionYm\(c\)\)/)
  const resumen = leer('app/[tenant]/finanzas/analitica/resumen/page.tsx')
  assert.match(resumen, /liquidation_month, status'/)
  assert.match(resumen, /c\.status !== 'cancelled' && commissionYm\(c\) === targetYm/)
  assert.match(leer('components/os/BusinessFinance.tsx'), /participant_type, status'/)
})

test('la tabla «Rendimiento y pago por persona» tampoco cuenta las canceladas', () => {
  const filas = [
    fila({ id: 'a', col: 'c1', cobro: '2026-10-03T10:00:00Z', liq: '2026-11-01', amount: 100 }),
    fila({ id: 'x', col: 'c2', cobro: '2026-10-04T10:00:00Z', liq: '2026-11-01', amount: 999, status: 'cancelled' }),
  ]
  const [persona] = buildTeamCommissionSummary(filas)
  assert.equal(persona.generated, 100)
  assert.equal(persona.outstanding, 100)
  assert.equal(persona.sales, 1, 'la venta de una fila cancelada no se atribuye a la persona')
})
