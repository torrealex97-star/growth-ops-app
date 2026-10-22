import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calcularTraficoWeb, rutaDe } from '../lib/analytics/trafico-web.ts'

const ev = (v, s, name, url, referrer, t) => ({
  visitor_id: v,
  session_id: s,
  event_name: name,
  url,
  referrer,
  occurred_at: `2026-10-01T10:${String(t).padStart(2, '0')}:00Z`,
})

test('cuenta visitantes y sesiones distintos, no filas', () => {
  const r = calcularTraficoWeb([
    ev('v1', 's1', 'page_view', 'https://x.com/oferta', null, 0),
    ev('v1', 's1', 'page_view', 'https://x.com/oferta', null, 1),
    ev('v1', 's2', 'page_view', 'https://x.com/', null, 2),
    ev('v2', 's3', 'page_view', 'https://x.com/oferta', null, 3),
  ])
  assert.equal(r.visitantes, 2)
  assert.equal(r.sesiones, 3)
  assert.equal(r.paginasVistas, 4)
  assert.deepEqual(r.topPaginas[0], { clave: '/oferta', visitantes: 2, porcentaje: 100 })
})

test('la fuente es utm_source, luego referrer, y cada visitante cuenta una vez (su primera visita)', () => {
  const r = calcularTraficoWeb([
    ev('v1', 's1', 'page_view', 'https://x.com/?utm_source=meta', null, 5),
    ev('v1', 's2', 'page_view', 'https://x.com/', 'https://www.google.com/', 9),
    ev('v2', 's3', 'page_view', 'https://x.com/', 'https://l.instagram.com/', 1),
    ev('v3', 's4', 'page_view', 'https://x.com/', null, 2),
    ev('v4', 's5', 'page_view', 'https://x.com/a', 'https://x.com/', 3),
  ])
  const f = Object.fromEntries(r.topFuentes.map((x) => [x.clave, x.visitantes]))
  assert.deepEqual(f, { meta: 1, instagram: 1, direct: 2 })
})

test('la primera fuente no depende del orden de lectura', () => {
  const r = calcularTraficoWeb([
    ev('v1', 's2', 'page_view', 'https://x.com/', 'https://www.google.com/', 9),
    ev('v1', 's1', 'page_view', 'https://x.com/?utm_source=meta', null, 5),
  ])
  assert.deepEqual(
    r.topFuentes.map((x) => x.clave),
    ['meta']
  )
})

test('conversión = visitantes con lead/compra entre visitantes; un lead sin visita no cuenta', () => {
  const r = calcularTraficoWeb([
    ev('v1', 's1', 'page_view', 'https://x.com/', null, 0),
    ev('v1', 's1', 'lead', 'https://x.com/', null, 1),
    ev('v2', 's2', 'page_view', 'https://x.com/', null, 2),
    ev('v9', 's9', 'purchase', 'https://x.com/', null, 3),
  ])
  assert.equal(r.conversion, 50)
})

test('sin datos no hay conversión inventada y rutaDe normaliza', () => {
  assert.equal(calcularTraficoWeb([]).conversion, null)
  assert.equal(rutaDe('https://x.com/oferta/?a=1'), '/oferta')
  assert.equal(rutaDe('https://x.com'), '/')
  assert.equal(rutaDe('no-url'), null)
})

test('la API exige permiso de pantalla y filtra por tenant', async () => {
  const { readFileSync } = await import('node:fs')
  const r = readFileSync('app/api/[tenant]/evergreen/trafico-web/route.ts', 'utf8')
  assert.match(r, /requirePantalla\(tenant, PANTALLA\)/)
  assert.match(r, /\.eq\('tenant_id', session\.tenantId\)/)
  assert.doesNotMatch(r, /select\('\*'\)/)
})

test('los eventos marcados bot se excluyen y se cuentan aparte; dispositivo y país se agrupan', () => {
  const r = calcularTraficoWeb([
    { ...ev('v1', 's1', 'page_view', 'https://x.com/', null, 0), bot: 'false', device: 'movil', country: 'ES' },
    { ...ev('v2', 's2', 'page_view', 'https://x.com/', null, 1), bot: 'true', device: 'escritorio', country: 'US' },
    { ...ev('v3', 's3', 'page_view', 'https://x.com/', null, 2), device: 'movil' },
  ])
  assert.equal(r.visitantes, 2)
  assert.equal(r.bots, 1)
  assert.deepEqual(r.topDispositivos, [{ clave: 'movil', visitantes: 2, porcentaje: 100 }])
  assert.deepEqual(r.topPaises, [{ clave: 'ES', visitantes: 1, porcentaje: 50 }])
})
