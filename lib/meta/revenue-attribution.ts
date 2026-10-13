import { cuentaComoVenta } from '@/lib/analytics'
import { isAttended, isCancelled, isNoShow, isRescheduled } from '@/lib/appointments/status'
import {
  canonicalCash,
  type InternalCollectionRow,
  type InternalRefundRow,
  type StripePaymentRow,
} from '@/lib/canonical/cash'
import {
  resolveMetaAttribution,
  type MetaAttributionCatalog,
  type MetaAttributionInput,
} from '@/lib/meta/ad-attribution'
import { chooseSaleAppointment } from '@/lib/sales/appointment-link'

export type RevenueAppointment = MetaAttributionInput & {
  id: string
  contact_id: string | null
  appointment_datetime: string
  status: string | null
}

export type RevenueSale = {
  id: string
  appointment_id: string | null
  contact_id: string | null
  sale_date: string | null
  gross_amount: number | string | null
  status: string
  reservation_completed_at: string | null
  payment_plan_method: string | null
}

export type RevenueCollection = InternalCollectionRow & { sale_id: string }
export type RevenueRefund = InternalRefundRow & { sale_id?: string | null }

export type AttributionLevel = 'campaign' | 'ad'

export type RevenueAttributionRow = {
  key: string
  level: AttributionLevel
  campaignId: string | null
  campaignExternalId: string | null
  campaignName: string | null
  adId: string | null
  adName: string | null
  resolved: boolean
  booked: number
  shows: number
  noShows: number
  unresolved: number
  sales: number
  bookedRevenue: number
  cashCollected: number
  showRate: number | null
  closeRate: number | null
  spend: number | null
  costPerBooking: number | null
  cashRoas: number | null
}

export type RevenueAttributionResult = {
  campaigns: RevenueAttributionRow[]
  ads: RevenueAttributionRow[]
  summary: Omit<RevenueAttributionRow, 'key' | 'level' | 'campaignId' | 'campaignName' | 'adId' | 'adName' | 'resolved'>
  coverage: {
    booked: number
    campaignAttributed: number
    adAttributed: number
    sales: number
    salesAttributed: number
    cashCollected: number
    cashAttributed: number
  }
}

type SpendMap = Record<string, number>

const num = (value: number | string | null | undefined) => {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

const ratio = (numerator: number, denominator: number) => (denominator > 0 ? (numerator / denominator) * 100 : null)
const moneyRatio = (numerator: number, denominator: number) => (denominator > 0 ? numerator / denominator : null)

function emptyRow(
  level: AttributionLevel,
  key: string,
  fields: Pick<
    RevenueAttributionRow,
    'campaignId' | 'campaignExternalId' | 'campaignName' | 'adId' | 'adName' | 'resolved'
  >,
  spend: number | null
): RevenueAttributionRow {
  return {
    key,
    level,
    ...fields,
    booked: 0,
    shows: 0,
    noShows: 0,
    unresolved: 0,
    sales: 0,
    bookedRevenue: 0,
    cashCollected: 0,
    showRate: null,
    closeRate: null,
    spend,
    costPerBooking: null,
    cashRoas: null,
  }
}

function finalize(row: RevenueAttributionRow): RevenueAttributionRow {
  return {
    ...row,
    showRate: ratio(row.shows, row.shows + row.noShows),
    closeRate: ratio(row.sales, row.shows),
    costPerBooking: row.spend === null ? null : moneyRatio(row.spend, row.booked),
    cashRoas: row.spend === null ? null : moneyRatio(row.cashCollected, row.spend),
  }
}

type AppointmentIndex = {
  byId: Map<string, RevenueAppointment>
  byContact: Map<string, RevenueAppointment[]>
}

function appointmentForSale(sale: RevenueSale, index: AppointmentIndex): RevenueAppointment | null {
  if (sale.appointment_id) return index.byId.get(sale.appointment_id) ?? null
  if (!sale.contact_id || !sale.sale_date) return null

  const saleTime = new Date(sale.sale_date).getTime()
  const earliest = saleTime - 90 * 24 * 60 * 60 * 1000
  const candidates = (index.byContact.get(sale.contact_id) ?? []).filter((appointment) => {
    const appointmentTime = new Date(appointment.appointment_datetime).getTime()
    return appointmentTime >= earliest && appointmentTime <= saleTime
  })
  const id = chooseSaleAppointment(
    candidates.map((appointment) => ({
      id: appointment.id,
      status: appointment.status,
      appointment_datetime: appointment.appointment_datetime,
    }))
  )
  return id ? (candidates.find((appointment) => appointment.id === id) ?? null) : null
}

function belongsToCohort(sale: RevenueSale, index: AppointmentIndex): boolean {
  if (sale.appointment_id) return index.byId.has(sale.appointment_id)
  if (!sale.contact_id || !sale.sale_date) return false
  const saleTime = new Date(sale.sale_date).getTime()
  const earliest = saleTime - 90 * 24 * 60 * 60 * 1000
  return (index.byContact.get(sale.contact_id) ?? []).some((appointment) => {
    const appointmentTime = new Date(appointment.appointment_datetime).getTime()
    return appointmentTime >= earliest && appointmentTime <= saleTime
  })
}

function cashForSale(
  saleId: string,
  collections: RevenueCollection[],
  refunds: RevenueRefund[],
  stripePayments: StripePaymentRow[]
): number {
  const saleCollections = collections.filter((collection) => collection.sale_id === saleId)
  const references = new Set(saleCollections.map((collection) => collection.payment_reference).filter(Boolean))
  const saleStripe = stripePayments.filter(
    (payment) => references.has(payment.payment_id) || (!!payment.charge_id && references.has(payment.charge_id))
  )
  const collectionIds = new Set(saleCollections.map((collection) => collection.id))
  const saleRefunds = refunds.filter((refund) => !!refund.collection_id && collectionIds.has(refund.collection_id))
  return canonicalCash(saleStripe, saleCollections, saleRefunds).net
}

/**
 * Embudo atribuible por cohorte de agenda. Las agendas llegan ya acotadas al periodo; ventas y cash
 * son los resultados posteriores de esa cohorte. Una venta ambigua queda fuera de la atribución y
 * se declara en cobertura: nunca se reparte ni se adivina.
 */
export function buildRevenueAttribution(input: {
  appointments: RevenueAppointment[]
  sales: RevenueSale[]
  collections: RevenueCollection[]
  refunds: RevenueRefund[]
  stripePayments: StripePaymentRow[]
  catalog: MetaAttributionCatalog
  campaignSpend?: SpendMap
}): RevenueAttributionResult {
  const eligibleAppointments = input.appointments.filter(
    (appointment) => !isCancelled(appointment.status) && !isRescheduled(appointment.status)
  )
  const attributionByAppointment = new Map(
    eligibleAppointments.map((appointment) => [appointment.id, resolveMetaAttribution(appointment, input.catalog)])
  )
  const appointmentIndex: AppointmentIndex = { byId: new Map(), byContact: new Map() }
  for (const appointment of eligibleAppointments) {
    appointmentIndex.byId.set(appointment.id, appointment)
    if (!appointment.contact_id) continue
    const rows = appointmentIndex.byContact.get(appointment.contact_id) ?? []
    rows.push(appointment)
    appointmentIndex.byContact.set(appointment.contact_id, rows)
  }
  const campaignRows = new Map<string, RevenueAttributionRow>()
  const adRows = new Map<string, RevenueAttributionRow>()

  const getRows = (appointment: RevenueAppointment) => {
    const attribution = attributionByAppointment.get(appointment.id)!
    const campaignKey = attribution.campaign.resolved
      ? `campaign:${attribution.campaign.internalId ?? attribution.campaign.externalId}`
      : 'campaign:unknown'
    const campaignSpendKey = attribution.campaign.internalId ?? attribution.campaign.externalId ?? ''
    if (!campaignRows.has(campaignKey)) {
      campaignRows.set(
        campaignKey,
        emptyRow(
          'campaign',
          campaignKey,
          {
            campaignId: attribution.campaign.internalId,
            campaignExternalId: attribution.campaign.externalId,
            campaignName: attribution.campaign.name,
            adId: null,
            adName: null,
            resolved: attribution.campaign.resolved,
          },
          attribution.campaign.resolved ? (input.campaignSpend?.[campaignSpendKey] ?? null) : null
        )
      )
    }

    const adKey = attribution.ad.resolved
      ? `ad:${attribution.ad.externalId ?? `${campaignKey}:${attribution.ad.name}`}`
      : `ad:unknown:${campaignKey}`
    if (!adRows.has(adKey)) {
      adRows.set(
        adKey,
        emptyRow(
          'ad',
          adKey,
          {
            campaignId: attribution.campaign.internalId,
            campaignExternalId: attribution.campaign.externalId,
            campaignName: attribution.campaign.name,
            adId: attribution.ad.externalId,
            adName: attribution.ad.name,
            resolved: attribution.ad.resolved,
          },
          null
        )
      )
    }
    return { campaign: campaignRows.get(campaignKey)!, ad: adRows.get(adKey)! }
  }

  for (const appointment of eligibleAppointments) {
    const rows = getRows(appointment)
    for (const row of [rows.campaign, rows.ad]) {
      row.booked += 1
      if (isAttended(appointment.status)) row.shows += 1
      else if (isNoShow(appointment.status)) row.noShows += 1
      else row.unresolved += 1
    }
  }

  const validSales = input.sales.filter(
    (sale) =>
      belongsToCohort(sale, appointmentIndex) &&
      cuentaComoVenta({
        status: sale.status,
        payment_plan_method: sale.payment_plan_method,
        reservation_completed_at: sale.reservation_completed_at,
      })
  )
  let salesAttributed = 0
  let cashAttributed = 0
  let totalCash = 0
  let revenueAttributed = 0

  for (const sale of validSales) {
    const cash = cashForSale(sale.id, input.collections, input.refunds, input.stripePayments)
    totalCash += cash
    const appointment = appointmentForSale(sale, appointmentIndex)
    if (!appointment) continue
    const rows = getRows(appointment)
    for (const row of [rows.campaign, rows.ad]) {
      row.sales += 1
      row.bookedRevenue += num(sale.gross_amount)
      row.cashCollected += cash
    }
    salesAttributed += 1
    cashAttributed += cash
    revenueAttributed += num(sale.gross_amount)
  }

  const campaigns = [...campaignRows.values()].map(finalize).sort((a, b) => b.booked - a.booked)
  const ads = [...adRows.values()].map(finalize).sort((a, b) => b.booked - a.booked)
  const shows = eligibleAppointments.filter((appointment) => isAttended(appointment.status)).length
  const noShows = eligibleAppointments.filter((appointment) => isNoShow(appointment.status)).length
  const unresolved = eligibleAppointments.length - shows - noShows
  const rowSpend = campaigns.map((row) => row.spend).filter((value): value is number => value !== null)
  const spend = rowSpend.length > 0 ? rowSpend.reduce((sum, value) => sum + value, 0) : null

  return {
    campaigns,
    ads,
    summary: finalize({
      ...emptyRow(
        'campaign',
        'summary',
        {
          campaignId: null,
          campaignExternalId: null,
          campaignName: null,
          adId: null,
          adName: null,
          resolved: true,
        },
        spend
      ),
      booked: eligibleAppointments.length,
      shows,
      noShows,
      unresolved,
      sales: salesAttributed,
      bookedRevenue: revenueAttributed,
      cashCollected: cashAttributed,
    }),
    coverage: {
      booked: eligibleAppointments.length,
      campaignAttributed: eligibleAppointments.filter(
        (appointment) => attributionByAppointment.get(appointment.id)?.campaign.resolved
      ).length,
      adAttributed: eligibleAppointments.filter(
        (appointment) => attributionByAppointment.get(appointment.id)?.ad.resolved
      ).length,
      sales: validSales.length,
      salesAttributed,
      cashCollected: totalCash,
      cashAttributed,
    },
  }
}
