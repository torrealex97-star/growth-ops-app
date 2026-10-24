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

  // El desglose por estado explica EXACTAMENTE el hueco, no lo replica: a3, a5, a6 y a7 no llegan
  // a un anuncio (todas 'sin_senas' a nivel ad) y a7 además no lleva señal de campaña.
  assert.deepEqual(result.coverage.estados.campaign, { sinSenas: 1, sinCampaign: 0, ambigua: 0, organica: 0 })
  assert.deepEqual(result.coverage.estados.ad, { sinSenas: 4, sinAnuncio: 0, ambigua: 0 })
  assert.equal(
    result.coverage.estados.campaign.sinSenas +
      result.coverage.estados.campaign.sinCampaign +
      result.coverage.estados.campaign.ambigua,
    result.coverage.booked - result.coverage.campaignAttributed,
    'la suma del desglose CIERRA el hueco de campaña'
  )
  assert.equal(
    result.coverage.estados.ad.sinSenas + result.coverage.estados.ad.sinAnuncio + result.coverage.estados.ad.ambigua,
    result.coverage.booked - result.coverage.adAttributed,
    'la suma del desglose CIERRA el hueco de anuncio'
  )

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

test('coverage.estados desglosa el hueco por causa: ambigua, sin_campaign, sin señas y orgánica', () => {
  const doble = {
    campaigns: [
      { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', external_id: '120252786405750750', name: 'Captación' },
      { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', external_id: '120211111111111111', name: 'Captación' },
    ],
    ads: [
      {
        external_id: '120299999999999999',
        campaign_external_id: '120252786405750750',
        name: 'Vídeo principal',
        adset_name: 'Lookalike',
      },
    ],
  }
  const appt = (id, extra = {}) => ({
    id,
    contact_id: `c-${id}`,
    appointment_datetime: '2026-10-01T10:00:00Z',
    status: 'show',
    utm_source: null,
    utm_campaign: null,
    utm_content: null,
    attribution_booking: null,
    contacts: null,
    ...extra,
  })
  const result = buildRevenueAttribution({
    appointments: [
      appt('a1', { utm_campaign: 'Captación', utm_content: 'Vídeo principal' }), // camp ambigua; sin ancla → el ad por nombre NO decide
      appt('a2', { utm_campaign: 'Captación' }), // camp ambigua; el ad ni siquiera lleva señal
      appt('a3', { utm_campaign: 'Campaña que no está en el catálogo' }), // señal pero sin_campaign
      appt('a4', { utm_campaign: 'direct' }), // orgánico: no es ads y no es hueco de ads igual por eso se declara
    ],
    sales: [],
    collections: [],
    refunds: [],
    stripePayments: [],
    catalog: doble,
    campaignSpend: {},
  })

  assert.equal(result.coverage.booked, 4)
  assert.equal(result.coverage.campaignAttributed, 0)
  assert.equal(result.coverage.adAttributed, 0)
  // Hueco de campaña = 4 = 2 ambiguo + 1 sin_campaign + 1 organica; NO hay 'sin_senas' porque las
  // cuatro llevan señal (aunque sea orgánica).
  assert.deepEqual(result.coverage.estados.campaign, { sinSenas: 0, sinCampaign: 1, ambigua: 2, organica: 1 })
  // Hueco de anuncio = 4 = 1 sin_anuncio (nombre sin ancla) + 3 sin_senas (nada de anuncio en el toque).
  assert.deepEqual(result.coverage.estados.ad, { sinSenas: 3, sinAnuncio: 1, ambigua: 0 })
})

test('metrics=bookings (includeCash: false) mantiene agendas/asistencias/cierres y declara que el cash NO se leyó', () => {
  const appointments = [
    appointment('a1', 'c1', 'show', {
      attribution_booking: { campaign_id: '120252786405750750', ad_id: '120299999999999999' },
    }),
    appointment('a2', 'c2', 'no_show', {
      attribution_booking: { campaign_id: '120252786405750750', ad_id: '120299999999999999' },
    }),
  ]
  const result = buildRevenueAttribution(
    {
      appointments,
      sales: [sale('s1', 'c1', 'a1', 100)],
      collections: [
        {
          id: 'col1',
          sale_id: 's1',
          payment_reference: 'pi_1',
          gross_amount: 100,
          status: 'collected',
          collected_at: '2026-10-02T12:00:00Z',
        },
      ],
      refunds: [],
      stripePayments: [],
      catalog,
      campaignSpend: { [campaignId]: 200 },
    },
    { includeCash: false }
  )

  // El embudo CRM (lo que pide Anuncios) no cambia.
  assert.equal(result.cashIncluded, false)
  assert.equal(result.summary.booked, 2)
  assert.equal(result.summary.shows, 1)
  assert.equal(result.summary.noShows, 1)
  assert.equal(result.summary.sales, 1, 'los cierres salen de sales, que sí se lee en modo bookings')
  assert.equal(result.coverage.adAttributed, 2)

  // Lo derivado de cash queda a cero declarado, no a cero medido.
  assert.equal(result.summary.cashCollected, 0)
  assert.equal(result.coverage.cashCollected, 0)
  assert.equal(result.coverage.cashAttributed, 0)
  assert.equal(result.campaigns.find((row) => row.resolved)?.cashRoas, null)
})

test('la ruta acepta metrics=bookings y en ese modo NO lanza las lecturas de cash', () => {
  const route = readFileSync('app/api/[tenant]/evergreen/meta/revenue-attribution/route.ts', 'utf8')
  assert.match(route, /searchParams\.get\('metrics'\)/)
  assert.match(route, /metrics !== 'bookings'/)
  // Las tres lecturas de cash van condicionadas a includeCash; si alguien las deja incondicionales,
  // el modo bookings vuelve a ser tan caro como el completo.
  assert.match(route, /const collections = includeCash\s*\?\s*await rowsByIds\(/)
  assert.match(route, /const refunds = includeCash\s*\?\s*await rowsByIds\(/)
  assert.match(route, /const \[stripeByPayment, stripeByCharge\] = includeCash\s*\?\s*await Promise\.all\(/)
  assert.match(route, /\{ includeCash \}/, 'el build recibe el modo')
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

test('la ruta adjunta el toque vigente del contacto a cada cita (contactAttribution)', () => {
  // Sin esto, las citas que llegan sin UTMs propios — la mayoría en producción — quedaban
  // «no identificado» aunque contact_attributions del comprador dijera de dónde vino.
  const route = readFileSync('app/api/[tenant]/evergreen/meta/revenue-attribution/route.ts', 'utf8')
  assert.match(route, /'contact_attributions'/)
  assert.match(route, /'contact_id,utm_source,utm_campaign,utm_content'/)
  assert.match(route, /attrByContact\.get/)
  assert.match(route, /contactAttribution:/)
})

test('el cliente de Meta pide instagram_profile_follow como campo de insights (no en actions)', () => {
  const client = readFileSync('lib/meta/client.ts', 'utf8')
  const matches = client.match(/instagram_profile_follow/g) ?? []
  assert.ok(matches.length >= 3, 'campo en campaña, anuncio y comentario/documentación')
  assert.ok(
    (client.match(/followers: Math\.max\(Number\(r\.instagram_profile_follow\)/g) ?? []).length >= 2,
    'el mapping usa el campo de insights (campaña y anuncio)'
  )
})
