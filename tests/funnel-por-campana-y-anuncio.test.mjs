import { test } from 'node:test'
import assert from 'node:assert/strict'
import { funnelByCampaignAndAd } from '../lib/analytics.ts'

const catalog = {
  campaigns: [{ id: 'uuid-vsl', external_id: '120252786405750750', name: 'Campaña VSL' }],
  ads: [{ external_id: 'ad-10', campaign_external_id: '120252786405750750', name: 'AD 10', adset_name: 'Frío' }],
}

const atr = (contact_id, { utm_source = null, utm_campaign = null, utm_content = null } = {}) => ({
  contact_id,
  source: null,
  utm_source,
  utm_campaign,
  utm_content,
  is_primary: true,
})
const venta = (contact_id) => ({
  id: `v-${contact_id}`,
  contact_id,
  status: 'active',
  gross_amount: 1000,
  sale_date: '2026-10-01',
  reservation_completed_at: null,
})
const cita = (contact_id) => ({
  appointment_datetime: '2026-10-01',
  status: 'scheduled',
  setter_id: null,
  closer_id: null,
  contact_id,
})

test('dos leads del mismo anuncio (uno por ad_id exacto, otro por utm_content) se agrupan juntos', () => {
  const atribuciones = [
    atr('a', { utm_source: '120252786405750750' }), // sin ad id: cae en "sin anuncio", no se funde con los de abajo
    atr('b', { utm_source: '120252786405750750', utm_content: 'AD 10' }),
    atr('c', { utm_source: '120252786405750750', utm_content: 'AD 10' }),
  ]
  const rows = funnelByCampaignAndAd(['a', 'b', 'c'], atribuciones, [venta('b')], [cita('b'), cita('c')], catalog)
  const filaAd10 = rows.find((r) => r.adExternalId === 'ad-10')
  assert.ok(filaAd10, 'el anuncio resuelto por utm_content aparece como fila propia')
  assert.equal(filaAd10.campaignName, 'Campaña VSL')
  assert.equal(filaAd10.adName, 'AD 10')
  assert.equal(filaAd10.leads, 2, 'b y c comparten el mismo anuncio resuelto')
  assert.equal(filaAd10.sales, 1)
  assert.equal(filaAd10.gross, 1000)

  const filaSinAnuncio = rows.find((r) => r.campaignName === 'Campaña VSL' && r.adExternalId === null)
  assert.ok(filaSinAnuncio, 'el lead sin ad_id ni utm_content queda en su propia fila de campaña, sin anuncio')
  assert.equal(filaSinAnuncio.leads, 1)
})

test('sin ninguna señal de Meta, el lead cae en la fila "sin campaña" (hueco honesto, no inventado)', () => {
  const rows = funnelByCampaignAndAd(
    ['x'],
    [atr('x', { utm_source: 'direct', utm_campaign: 'organic' })],
    [],
    [],
    catalog
  )
  assert.equal(rows.length, 1)
  assert.equal(rows[0].campaignName, null)
  assert.equal(rows[0].campaignResolved, false)
  assert.equal(rows[0].leads, 1)
})

test('ordena por facturación y después por leads, igual que el resto de desgloses del dashboard', () => {
  const atribuciones = [
    atr('a', { utm_source: '120252786405750750', utm_content: 'AD 10' }),
    atr('b', { utm_source: 'direct', utm_campaign: 'organic' }),
    atr('c', { utm_source: 'direct', utm_campaign: 'organic' }),
  ]
  const rows = funnelByCampaignAndAd(['a', 'b', 'c'], atribuciones, [venta('a')], [], catalog)
  assert.equal(rows[0].adExternalId, 'ad-10', 'la fila con ventas va primero aunque tenga menos leads')
})
