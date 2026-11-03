import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { embudoSimple } from '../lib/collaborators/embudo-simple.ts'

test('cuenta agendaron, asistieron y cerraron sobre SUS personas; la devuelta no cuenta como cierre', () => {
  const r = embudoSimple(
    [
      { id: 'a', full_name: 'A' },
      { id: 'b', full_name: 'B' },
      { id: 'c', full_name: 'C' },
    ],
    [
      { contact_id: 'a', status: 'show' },
      { contact_id: 'b', status: 'cancelled' },
      { contact_id: 'c', status: 'show' },
    ],
    [
      { contact_id: 'a', status: 'active', gross_amount: 1000, sale_date: '2026-10-01' },
      { contact_id: 'c', status: 'refunded', gross_amount: 600, sale_date: '2026-10-02' },
    ]
  )
  assert.equal(r.agendaron, 2)
  assert.equal(r.asistieron, 2)
  assert.equal(r.cerraron, 1)
  assert.equal(r.cierre, 50)
  assert.equal(r.lista.find((p) => p.id === 'c').devuelto, true)
})

test('sin asistencias no se inventa una tasa de cierre', () => {
  assert.equal(embudoSimple([{ id: 'a', full_name: null }], [], []).cierre, null)
})

test('las colaboradoras acceden a dashboard, tareas, CRM y Ventas (cada pantalla filtra por lo atribuido), sin analítica ni comisiones', () => {
  const p = readFileSync('lib/auth/permissions.ts', 'utf8')
  const base = p.indexOf('const ROLE_ALLOWED_PREFIXES')
  const ini = p.indexOf('affiliate: [', base)
  const bloque = p.slice(ini, p.indexOf('gestoria: [', ini))
  for (const ruta of ["'/dashboard'", "'/tasks'", "'/crm'", "'/ventas'"]) assert.ok(bloque.includes(ruta), ruta)
  assert.ok(!bloque.includes("'/analitica") && !bloque.includes("'/comisiones'"))
})

test('una colaboradora solo crea tareas para sí misma', () => {
  const r = readFileSync('app/api/[tenant]/evergreen/tasks/route.ts', 'utf8')
  assert.match(r, /esColab \? t\.userId/)
})

test('el embudo sencillo calcula el método del plan para que una reserva abierta no cuente como cierre (D8)', () => {
  const c = readFileSync('components/analitica/EmbudoColaboradora.tsx', 'utf8')
  assert.match(c, /payment_plan_method: metodoDePlan/)
})
