import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildRevenueAttribution } from '../lib/meta/revenue-attribution.ts'

const campaignId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const catalog = {
  campaigns: [{ id: campaignId, external_id: '120252786405750750', name: 'Captación' }],
  ads: [
    {
      external_id: '120299999999999999',
      campaign_external_id: '120252786405750750',
      name: 'Hook principal',
      adset_name: 'Lookalike',
    },
  ],
}

const appointment = (id, contactId, status, extra = {}) => ({
  id,
  contact_id: contactId,
  appointment_datetime: '2026-10-01T10:00:00Z',
  status,
  utm_source: '120252786405750750',
  attribution_booking: null,
  contacts: { campaign_id: campaignId },
  ...extra,
})

const sale = (id, contactId, appointmentId, amount, extra = {}) => ({
  id,
  appointment_id: appointmentId,
  contact_id: contactId,
  sale_date: '2026-10-02',
  gross_amount: amount,
  status: 'active',
  reservation_completed_at: null,
  payment_plan_method: null,
  ...extra,
})

test('construye agenda → asistencia → venta → cash sin inventar anuncios ni enlaces ambiguos', () => {
  const appointments = [
    appointment('a1', 'c1', 'show', {
      attribution_booking: { campaign_id: '120252786405750750', ad_id: '120299999999999999' },
    }),
    appointment('a2', 'c2', 'no_show', {
      attribution_booking: { campaign_id: '120252786405750750', ad_id: '120299999999999999' },
    }),
    appointment('a3', 'c3', 'scheduled'),
    appointment('a4', 'c4', 'cancelled'),
    appointment('a5', 'c5', 'show'),
    appointment('a6', 'c5', 'show', { appointment_datetime: '2026-10-01T12:00:00Z' }),
    appointment('a7', 'c7', 'show', { utm_source: null, utm_campaign: null, contacts: null }),
  ]
  const sales = [
    sale('s1', 'c1', 'a1', 100),
    sale('s3', 'c3', 'a3', 50),
    sale('s5', 'c5', null, 25),
    sale('reservation', 'c2', 'a2', 400, { payment_plan_method: 'reserva' }),
  ]
  const collections = [
    {
      id: 'col1',
      sale_id: 's1',
      payment_reference: 'pi_1',
      gross_amount: 100,
      status: 'collected',
      collected_at: '2026-10-02T12:00:00Z',
    },
    {
      id: 'col3',
      sale_id: 's3',
      payment_reference: 'transfer_3',
      gross_amount: 50,
      status: 'collected',
      collected_at: '2026-10-02T12:00:00Z',
    },
    {
      id: 'col5',
      sale_id: 's5',
      payment_reference: null,
      gross_amount: 25,
      status: 'collected',
      collected_at: '2026-10-02T12:00:00Z',
    },
  ]
  const stripePayments = [
    {
      payment_id: 'pi_1',
      charge_id: 'ch_1',
      amount: 100,
      refunded_amount: 10,
      status: 'partially_refunded',
      paid_at: '2026-10-02T12:00:00Z',
      refunded_at: null,
      customer_email: null,
      currency: 'eur',
      fx_rate_to_eur: null,
    },
  ]

  const result = buildRevenueAttribution({
    appointments,
    sales,
    collections,
    refunds: [],
    stripePayments,
    catalog,
    campaignSpend: { [campaignId]: 200 },
  })

  assert.equal(result.summary.booked, 6, 'una cancelación no entra en el embudo')
  assert.equal(result.summary.shows, 4)
  assert.equal(result.summary.noShows, 1)
  assert.equal(result.summary.unresolved, 1)
  assert.equal(
    result.summary.sales,
    2,
    'la reserva abierta y la venta con dos shows ambiguos no cuentan como atribuidas'
  )
  assert.equal(result.summary.bookedRevenue, 150)
  assert.equal(result.summary.cashCollected, 140, 'Stripe gana al duplicado interno y resta su refund')
  assert.equal(result.coverage.sales, 3)
  assert.equal(result.coverage.salesAttributed, 2)
  assert.equal(result.coverage.cashCollected, 165)
  assert.equal(result.coverage.cashAttributed, 140)
  assert.equal(result.coverage.campaignAttributed, 5)
  assert.equal(result.coverage.adAttributed, 2)

  const knownCampaign = result.campaigns.find((row) => row.resolved)
  assert.ok(knownCampaign)
  assert.equal(knownCampaign.booked, 5)
  assert.equal(knownCampaign.spend, 200)
  assert.equal(knownCampaign.cashRoas, 0.7)

  const knownAd = result.ads.find((row) => row.resolved)
  assert.ok(knownAd)
  assert.equal(knownAd.booked, 2)
  assert.equal(knownAd.shows, 1)
  assert.equal(knownAd.noShows, 1)
  assert.equal(knownAd.sales, 1)
  assert.equal(knownAd.cashCollected, 90)

  assert.ok(result.ads.some((row) => !row.resolved && row.campaignName === 'Captación'))
  assert.ok(
    result.campaigns.some((row) => !row.resolved),
    'la campaña desconocida permanece visible'
  )
})

test('devuelve null, no cero, cuando una tasa no tiene denominador', () => {
  const result = buildRevenueAttribution({
    appointments: [appointment('pending', 'contact', 'scheduled')],
    sales: [],
    collections: [],
    refunds: [],
    stripePayments: [],
    catalog,
  })
  assert.equal(result.summary.showRate, null)
  assert.equal(result.summary.closeRate, null)
  assert.equal(result.summary.cashRoas, null)
  assert.equal(result.campaigns[0].costPerBooking, null)
})

test('la API exige tenant, permiso, paginación y nunca consulta datos globales', () => {
  const route = readFileSync('app/api/[tenant]/evergreen/meta/revenue-attribution/route.ts', 'utf8')
  assert.match(route, /requireTenant\(tenant\)/)
  assert.match(route, /auth\.isSuperAdmin/)
  assert.match(route, /fetchAllRows/)
  assert.ok((route.match(/\.eq\('tenant_id', tenantId\)/g) ?? []).length >= 5)
  assert.match(route, /hasCampaignScope/)
  assert.match(route, /!hasCampaignScope/)
  assert.doesNotMatch(route, /select\('\*'\)/)
  assert.match(route, /Lectura incompleta/)
})
