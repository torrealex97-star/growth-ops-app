import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { trocearSenales } from '../lib/meta/ad-attribution.ts'

const leer = (p) => readFileSync(p, 'utf8')
const ids = (n, base = 1e12) => Array.from({ length: n }, (_, i) => String(base + i))

test('el catálogo del Dashboard se pide en bloques de 300 IDs por tipo (la ruta rechaza más)', () => {
  const bloques = trocearSenales({
    campaignExternalIds: ids(650),
    campaignInternalIds: [],
    adExternalIds: ids(10, 2e12),
  })
  assert.equal(bloques.length, 3)
  for (const b of bloques) {
    assert.ok(b.campaignExternalIds.length <= 300 && b.adExternalIds.length <= 300)
  }
  assert.equal(bloques.flatMap((b) => b.campaignExternalIds).length, 650)
  assert.equal(bloques.flatMap((b) => b.adExternalIds).length, 10)
})

test('sin señales no se pide nada y con pocas es una sola petición', () => {
  assert.deepEqual(trocearSenales({ campaignExternalIds: [], campaignInternalIds: [], adExternalIds: [] }), [])
  assert.equal(trocearSenales({ campaignExternalIds: ids(3), campaignInternalIds: [], adExternalIds: [] }).length, 1)
})

test('las APIs de funnel y tráfico usan los días del negocio (Madrid), no UTC', () => {
  for (const p of [
    'app/api/[tenant]/evergreen/funnel-eventos/route.ts',
    'app/api/[tenant]/evergreen/trafico-web/route.ts',
  ]) {
    const r = leer(p)
    assert.match(r, /businessStartOfDay/, p)
    assert.match(r, /businessEndOfDay/, p)
    assert.match(r, /businessToday\(\)/, p)
    assert.doesNotMatch(r, /\.(gte|lte)\('occurred_at', `/, p)
  }
})

test('«Todo el periodo» pide un rango explícito de 12 meses y lo dice en pantalla', () => {
  for (const p of [
    'app/[tenant]/marketing/adquisicion/funnel-eventos/page.tsx',
    'app/[tenant]/marketing/adquisicion/trafico-web/page.tsx',
  ]) {
    const s = leer(p)
    assert.match(s, /preset === 'all'/, p)
    assert.match(s, /addDaysYmd\(hoy, -364\)/, p)
    assert.match(s, /últimos 12 meses/, p)
  }
})

test('activar el webhook de Calendly no devuelve la signing key por la red', () => {
  const r = leer('app/api/[tenant]/evergreen/settings/integraciones/history-sync/route.ts')
  assert.doesNotMatch(r, /\.\.\.resultado\s*\}/)
  assert.match(r, /signingKeyActualizada: resultado\.signingKeyNueva !== null/)
})

test('el estado vacío de campaña/anuncio no promete «solo Meta»', () => {
  const c = leer('components/os/CampaignAdAttributionTable.tsx')
  assert.match(c, /Sin leads con atribución en el periodo/)
})

test('el reproceso de eventos solo lo ejecuta admin/director', () => {
  const r = leer('app/api/[tenant]/evergreen/tracking/reproceso/route.ts')
  assert.match(r, /\['admin', 'director'\]/)
  assert.doesNotMatch(r, /requirePantalla/)
})
