import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularFunnelEventos } from '../lib/analytics/funnel-eventos.ts'

const pasos = [
  { id: 'a', label: 'A', eventos: ['page_view'] },
  { id: 'b', label: 'B', eventos: ['cta_click', 'vsl_view'] },
  { id: 'c', label: 'C', eventos: ['lead'] },
]
const ev = (v, name, iso, extra = {}) => ({
  visitor_id: v,
  contact_id: null,
  event_name: name,
  occurred_at: iso,
  ...extra,
})
const h = (n) => new Date(Date.UTC(2026, 9, 1, n)).toISOString()

test('cuenta personas que recorren los pasos en orden y calcula conversión y abandono', () => {
  const r = calcularFunnelEventos(
    [
      ev('v1', 'page_view', h(0)),
      ev('v1', 'cta_click', h(1)),
      ev('v1', 'lead', h(2)),
      ev('v2', 'page_view', h(0)),
      ev('v2', 'vsl_view', h(1)),
      ev('v3', 'page_view', h(0)),
    ],
    pasos
  )
  assert.deepEqual(
    r.pasos.map((p) => p.personas),
    [3, 2, 1]
  )
  assert.equal(r.pasos[1].conversionDesdeAnterior, (2 / 3) * 100)
  assert.equal(r.pasos[2].conversionDesdeTope, (1 / 3) * 100)
  assert.deepEqual(
    r.pasos.map((p) => p.abandonados),
    [0, 1, 1]
  )
})

test('el orden importa: un lead antes del clic no cuenta como paso 3', () => {
  const r = calcularFunnelEventos(
    [ev('v1', 'page_view', h(0)), ev('v1', 'lead', h(1)), ev('v1', 'cta_click', h(2))],
    pasos
  )
  assert.deepEqual(
    r.pasos.map((p) => p.personas),
    [1, 1, 0]
  )
})

test('la ventana corta la cadena: pasos fuera de plazo no cuentan', () => {
  const dentro = [ev('v1', 'page_view', h(0)), ev('v1', 'cta_click', h(10))]
  assert.equal(calcularFunnelEventos(dentro, pasos, { ventanaHoras: 24 }).pasos[1].personas, 1)
  assert.equal(calcularFunnelEventos(dentro, pasos, { ventanaHoras: 5 }).pasos[1].personas, 0)
})

test('un inicio posterior que sí cabe en la ventana rescata la cadena', () => {
  const r = calcularFunnelEventos(
    [ev('v1', 'page_view', h(0)), ev('v1', 'page_view', h(30)), ev('v1', 'cta_click', h(40))],
    pasos,
    { ventanaHoras: 24 }
  )
  assert.equal(r.pasos[1].personas, 1)
})

test('repetir un evento no infla el recuento: se cuentan personas, no filas', () => {
  const r = calcularFunnelEventos(
    [ev('v1', 'page_view', h(0)), ev('v1', 'page_view', h(1)), ev('v1', 'page_view', h(2))],
    pasos
  )
  assert.equal(r.pasos[0].personas, 1)
})

test('sin visitor usa el contacto; sin ninguno de los dos se cuenta aparte', () => {
  const r = calcularFunnelEventos(
    [
      { visitor_id: null, contact_id: 'c1', event_name: 'page_view', occurred_at: h(0) },
      { visitor_id: null, contact_id: null, event_name: 'page_view', occurred_at: h(0) },
    ],
    pasos
  )
  assert.equal(r.entraron, 1)
  assert.equal(r.sinIdentidad, 1)
})

test('eventos ajenos al funnel se ignoran y sin datos no hay divisiones por cero', () => {
  const r = calcularFunnelEventos([ev('v1', 'otro', h(0))], pasos)
  assert.equal(r.entraron, 0)
  assert.equal(r.pasos[1].conversionDesdeAnterior, null)
  assert.equal(r.pasos[2].conversionDesdeTope, null)
})

test('la API exige permiso de pantalla, filtra por tenant y no lee properties', async () => {
  const { readFileSync } = await import('node:fs')
  const r = readFileSync('app/api/[tenant]/evergreen/funnel-eventos/route.ts', 'utf8')
  assert.match(r, /requirePantalla\(tenant, PANTALLA\)/)
  assert.match(r, /\.eq\('tenant_id', session\.tenantId\)/)
  assert.match(r, /select\('visitor_id,contact_id,event_name,occurred_at'\)/)
  assert.doesNotMatch(r, /select\('\*'\)/)
})
