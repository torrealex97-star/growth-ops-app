import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { sinEvidenciaCampana, toquesDesdeFichaGhl } from '../lib/contacts/backfill-atribucion-ghl.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const backfill = readFileSync(join(root, 'lib/contacts/backfill-atribucion-ghl.ts'), 'utf8')
const compras = readFileSync(join(root, 'lib/webhooks/entradaCompras.ts'), 'utf8')
const route = readFileSync(
  join(root, 'app/api/[tenant]/evergreen/settings/integraciones/atribucion-backfill/route.ts'),
  'utf8'
)
const panel = readFileSync(join(root, 'app/[tenant]/settings/integraciones/page.tsx'), 'utf8')

// Un comprador cuya ficha GHL conserva la atribución Meta del lead (forma real de los payloads
// de GHL, vista en raw_events): first/last attribution con campaña y anuncio.
const FICHA_COMPRADOR = {
  id: 'ghl-contact-1',
  firstAttributionSource: {
    sessionSource: 'Facebook Ads',
    utmSource: '120252786405750750',
    utmMedium: 'paid_social',
    utmCampaign: 'VSL - Agenda',
    utmContent: 'Video Testimonio v2',
    adId: '120299999999999999',
    adName: 'Creatividad vídeo',
  },
  lastAttributionSource: {
    sessionSource: 'Facebook Ads',
    utmSource: '120252786405750750',
    adId: '120299999999999999',
  },
}

test('la ficha GHL se traduce a toques en orden cronológico declarado (first → last), no por arrays', () => {
  const toques = toquesDesdeFichaGhl(FICHA_COMPRADOR)
  assert.equal(toques.length, 2)
  assert.equal(toques[0].utmCampaign, 'VSL - Agenda')
  assert.equal(toques[0].utmContent, 'Video Testimonio v2', 'el primer toque conserva la creatividad')
  assert.equal(toques[0].adId, '120299999999999999')
  assert.equal(toques[0].evidenceSource, 'provider_first')
  assert.equal(toques[1].evidenceSource, 'provider_last')
  assert.equal(toques[1].source, 'Facebook Ads', 'sessionSource alimenta el canal')
})

test('objetos vacíos o formas no documentadas se descartan: sin evidencia no hay toque', () => {
  assert.deepEqual(toquesDesdeFichaGhl({ firstAttributionSource: {}, lastAttributionSource: null }), [])
  assert.deepEqual(
    toquesDesdeFichaGhl({ attributions: [{ utmSource: '123456789012345' }] }),
    [],
    'el array attributions[] NO se usa: su orden no está documentado'
  )
  assert.deepEqual(toquesDesdeFichaGhl({}), [])
})

test('el hueco es no tener identidad de campaña en las dos columnas; un dato existente no se toca', () => {
  assert.equal(sinEvidenciaCampana({ utm_source: null, utm_campaign: null }), true)
  assert.equal(sinEvidenciaCampana({ utm_source: '120252786405750750', utm_campaign: null }), false)
  assert.equal(sinEvidenciaCampana({ utm_source: null, utm_campaign: 'VSL - Agenda' }), false)
})

test('el webhook de compra enriquece con la ficha GHL solo cuando el payload no trae evidencia', () => {
  assert.match(compras, /!tieneEvidenciaAtribucionGhl\(toquePayload\)/)
  assert.match(compras, /enriquecerAtribucionDesdeContactoGhl\(toquePayload, ghlContactId, cfg\.GHL_API_TOKEN\)/)
  // El toque propio de la compra conserva la fuente declarada (antes: atribuirDesdePayload con meta.source)
  assert.match(compras, /trayectoria\.booking\.source \?\? fuente/)
  // Sin datos no se escribe nada: sin toques no hay registrarToque
  assert.match(compras, /for \(const toque of toques\)/)
})

test('el backfill registra con registrarToque (first-wins) y con presupuesto propio, no sin candado', () => {
  assert.match(backfill, /registrarToque\(sb, tenantId, objetivo\.id, toque\)/)
  assert.match(backfill, /Date\.now\(\) > deadlineMs/, 'el reloj se mira ANTES de cada llamada externa')
  assert.match(backfill, /AbortSignal\.timeout\(10_000\)/)
  assert.match(backfill, /esComprador: r\.lead_status === 'venta'/, 'los compradores van primero')
  assert.match(route, /job: 'ghl-atribucion-backfill'/)
  assert.match(route, /\['admin', 'director'\]/)
  assert.match(route, /maxDuration = 60/)
  assert.match(route, /DEADLINE_MS = 25_000/, 'presupuesto interno mucho menor que maxDuration')
})

test('el panel expone el backfill en el grupo GHL con estado de carga', () => {
  assert.match(panel, /integraciones\/atribucion-backfill/)
  assert.match(panel, /ghl-atribucion-backfill/)
})
