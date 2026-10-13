import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { collectMetaAttributionSignals, resolveMetaAttribution } from '../lib/meta/ad-attribution.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const catalog = {
  campaigns: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      external_id: '120252786405750750',
      name: 'Campaña captación',
    },
  ],
  ads: [
    {
      external_id: '120299999999999999',
      campaign_external_id: '120252786405750750',
      name: 'Vídeo principal',
      adset_name: 'Lookalike compradores',
    },
  ],
}

test('traduce el campaign id numérico que GHL guarda como utm_source', () => {
  const result = resolveMetaAttribution({ utm_source: '120252786405750750' }, catalog)
  assert.equal(result.campaign.name, 'Campaña captación')
  assert.equal(result.campaign.externalId, '120252786405750750')
  assert.equal(result.ad.externalId, null)
  assert.equal(result.ad.name, null, 'no inventa un anuncio a partir de la campaña')
})

test('resuelve ad id y conserva campaign id, nombre de anuncio y conjunto', () => {
  const result = resolveMetaAttribution(
    {
      attribution_booking: {
        campaignId: '120252786405750750',
        adId: '120299999999999999',
        adSetId: '120288888888888888',
      },
    },
    catalog
  )
  assert.equal(result.campaign.name, 'Campaña captación')
  assert.equal(result.ad.name, 'Vídeo principal')
  assert.equal(result.ad.externalId, '120299999999999999')
  assert.equal(result.adSet.name, 'Lookalike compradores')
  assert.equal(result.adSet.externalId, '120288888888888888')
})

test('un ad id desconocido se conserva como evidencia sin atribuirle un nombre falso', () => {
  const result = resolveMetaAttribution({ attribution_first: { ad_id: '120277777777777777' } }, catalog)
  assert.equal(result.ad.externalId, '120277777777777777')
  assert.equal(result.ad.name, null)
  assert.equal(result.ad.resolved, false)
})

test('acepta el nombre declarado por el proveedor pero no lo marca como fila de catálogo', () => {
  const result = resolveMetaAttribution(
    { attribution_last: { ad_id: '120277777777777777', ad_name: 'Creatividad declarada por GHL' } },
    catalog
  )
  assert.equal(result.ad.name, 'Creatividad declarada por GHL')
  assert.equal(result.ad.resolved, true)
})

test('recoge solo ids válidos para el endpoint mínimo y deduplica', () => {
  const result = collectMetaAttributionSignals([
    {
      utm_source: '120252786405750750',
      attribution_booking: { ad_id: '120299999999999999' },
      contacts: { campaign_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    },
    { utm_source: 'facebook', attribution_booking: { ad_id: 'no-es-un-id' } },
    { utm_source: '120252786405750750' },
  ])
  assert.deepEqual(result, {
    campaignExternalIds: ['120252786405750750'],
    campaignInternalIds: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
    adExternalIds: ['120299999999999999'],
  })
})

test('el catálogo de CRM exige sesión, permiso y tenant sin exponer métricas publicitarias', () => {
  const route = readFileSync(join(root, 'app/api/[tenant]/evergreen/appointments/attribution-catalog/route.ts'), 'utf8')
  assert.match(route, /requireTenant\(tenant\)/)
  assert.match(route, /PERMISSIONS\.canViewAppointments/)
  assert.ok((route.match(/\.eq\('tenant_id', auth\.tenantId\)/g) ?? []).length >= 3)
  assert.match(route, /select\('id,external_id,name'\)/)
  assert.match(route, /select\('external_id,campaign_external_id,name,adset_name'\)/)
  assert.doesNotMatch(route, /select\([^\n]*(spend|impressions|clicks)/)
})
