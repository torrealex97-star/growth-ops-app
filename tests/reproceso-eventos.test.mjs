import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ruta = readFileSync('app/api/[tenant]/evergreen/tracking/reproceso/route.ts', 'utf8')
const ingesta = readFileSync('app/api/track/[site]/route.ts', 'utf8')
const normalizar = readFileSync('lib/tracking/normalizar.ts', 'utf8')

test('el reproceso exige permiso de pantalla, filtra por tenant y acota el lote', () => {
  assert.match(ruta, /\['admin', 'director'\]/)
  assert.match(ruta, /\.eq\('tenant_id', session\.tenantId\)/)
  assert.match(ruta, /\.eq\('processing_status', 'received'\)/)
  assert.match(ruta, /LIMITE_MAXIMO = 200/)
  assert.doesNotMatch(ruta, /select\('\*'\)/)
})

test('ingesta y reproceso comparten el mismo normalizador (no hay dos copias)', () => {
  assert.match(ingesta, /normalizarEventoRaw\(/)
  assert.match(ruta, /normalizarEventoRaw\(/)
  assert.doesNotMatch(ingesta, /from\('canonical_events'\)/)
  assert.match(normalizar, /onConflict: 'tenant_id,source,source_event_id'/)
})

test('no hay cron nuevo para el reproceso', () => {
  const vercel = readFileSync('vercel.json', 'utf8')
  assert.doesNotMatch(vercel, /reproceso/)
})
