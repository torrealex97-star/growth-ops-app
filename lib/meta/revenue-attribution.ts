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

export type AttributionLevel = 'campaign' | 'ad' | 'colaborador'

/**
 * DESGLOSE DEL HUECO POR CAUSA (un hueco no es un cero): cuántas agendas elegibles caen en cada
 * estado no resuelto del resolver. Los estados de resolución correcta (identidad/nombre/toque) no
 * se listan: booked − atribuido lo cierra. La suma de los estados NO resueltos de cada nivel ES
 * exactamente ese hueco — si alguien rompe el invariante, el desglose ya no explica la nota.
 *
 * Campaign: 'sin_senas' (el toque no lleva señal de campaña), 'sin_campaign' (señal pero la
 * campaña no está en el catálogo: fuera de sync o borrada), 'ambigua' (≥2 campañas comparten el
 * nombre normalizado — el nombre NO decide), 'organica' (orgánico/direct: no es ads).
 * Ad: 'sin_senas' (nada de anuncio en el toque), 'sin_anuncio' (nombre en el toque, no matchea
 * ningún anuncio del catálogo) y 'ambigua' (el nombre matchea ≥2 anuncios: homónimos de
 * placements/variantes, o sin ancla de campaña para acotarlo).
 */
export type EstadosNoResueltos = {
  campaign: { sinSenas: number; sinCampaign: number; ambigua: number; organica: number }
  ad: { sinSenas: number; sinAnuncio: number; ambigua: number }
}

const estadosVacios = (): EstadosNoResueltos => ({
  campaign: { sinSenas: 0, sinCampaign: 0, ambigua: 0, organica: 0 },
  ad: { sinSenas: 0, sinAnuncio: 0, ambigua: 0 },
})

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
  /** Filas por COLABORADORA (atribución estructurada del contacto). Vacío si el consumidor no pasa `colaboradorDe`. */
  colaboradores: RevenueAttributionRow[]
  summary: Omit<RevenueAttributionRow, 'key' | 'level' | 'campaignId' | 'campaignName' | 'adId' | 'adName' | 'resolved'>
  coverage: {
    booked: number
    campaignAttributed: number
    adAttributed: number
    sales: number
    salesAttributed: number
    cashCollected: number
    cashAttributed: number
    /** Desglose del hueco por causa para la nota de cobertura de las pantallas. */
    estados: EstadosNoResueltos
  }
  /** false = el consumidor pidió solo el embudo CRM y el cash NO se leyó: sus ceros no son medidos. */
  cashIncluded: boolean
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

/**
 * Modo «sin cash»: cuando el consumidor solo pide el embudo CRM (agendas/asistencias/cierres,
 * p. ej. las columnas de Anuncios), se saltan las lecturas de cobros, refunds y Stripe — el conteo
 * de agendas y de cierres no cambia, pero todo lo derivado de cash (cashCollected, cashRoas y el
 * cash de cobertura) queda a cero y el resultado lo declara con `cashIncluded: false`: un valor
 * no pedido no es un cero medido.
 */
export type RevenueAttributionOptions = { includeCash?: boolean }

function finalize(row: RevenueAttributionRow, includeCash = true): RevenueAttributionRow {
  return {
    ...row,
    showRate: ratio(row.shows, row.shows + row.noShows),
    closeRate: ratio(row.sales, row.shows),
    costPerBooking: row.spend === null ? null : moneyRatio(row.spend, row.booked),
    // Sin cash leído no hay ROAS: sería 0/spend = 0, un cero que parece medido y no lo es.
    cashRoas: includeCash && row.spend !== null ? moneyRatio(row.cashCollected, row.spend) : null,
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
export function buildRevenueAttribution(
  input: {
    appointments: RevenueAppointment[]
    sales: RevenueSale[]
    collections: RevenueCollection[]
    refunds: RevenueRefund[]
    stripePayments: StripePaymentRow[]
    catalog: MetaAttributionCatalog
    campaignSpend?: SpendMap
    /**
     * Dimensión COLABORADORA: contacto → perfil estructurado (contact_attributions.collaborator_id
     * + nombre legible de collaborator_profiles). Independiente del resolver de Meta: lleva el lead
     * es el trabajo de la colaboradora, no una señal de campaña. Ids sin perfil legible conservan el
     * id (fila resuelta con nombre null); sin colaborador cae en `colab:unknown` («Sin colaborador»).
     */
    colaboradorDe?: Map<string, { id: string; name: string | null }> | null
  },
  { includeCash = true }: RevenueAttributionOptions = {}
): RevenueAttributionResult {
  const collections = includeCash ? input.collections : []
  const refunds = includeCash ? input.refunds : []
  const stripePayments = includeCash ? input.stripePayments : []
  const eligibleAppointments = input.appointments.filter(
    (appointment) => !isCancelled(appointment.status) && !isRescheduled(appointment.status)
  )
  const attributionByAppointment = new Map(
    eligibleAppointments.map((appointment) => [appointment.id, resolveMetaAttribution(appointment, input.catalog)])
  )
  // El desglose por estado se construye sobre la MISMA resolución que llena las filas y la
  // cobertura: cero lecturas nuevas y garantía de que explica exactamente el hueco de arriba.
  const estados = estadosVacios()
  for (const attribution of attributionByAppointment.values()) {
    if (attribution.campaign.resolved) {
      // Resuelto (identidad/nombre): no es hueco, no entra en el desglose.
    } else if (attribution.campaign.estado === 'sin_senas') estados.campaign.sinSenas += 1
    else if (attribution.campaign.estado === 'sin_campaign') estados.campaign.sinCampaign += 1
    else if (attribution.campaign.estado === 'ambigua') estados.campaign.ambigua += 1
    else if (attribution.campaign.estado === 'organica') estados.campaign.organica += 1

    if (attribution.ad.resolved) {
      // Resuelto (toque/nombre declarado): no es hueco, no entra en el desglose.
    } else if (attribution.ad.estado === 'sin_senas') estados.ad.sinSenas += 1
    else if (attribution.ad.estado === 'sin_anuncio') estados.ad.sinAnuncio += 1
    else if (attribution.ad.estado === 'ambigua') estados.ad.ambigua += 1
  }
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
  const colabRows = new Map<string, RevenueAttributionRow>()

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
    const colab = appointment.contact_id ? input.colaboradorDe?.get(appointment.contact_id) : undefined
    const colabKey = colab ? `colab:${colab.id}` : 'colab:unknown'
    if (!colabRows.has(colabKey)) {
      colabRows.set(
        colabKey,
        emptyRow(
          'colaborador',
          colabKey,
          {
            campaignId: null,
            campaignExternalId: colab?.id ?? null,
            campaignName: colab?.name ?? null,
            adId: null,
            adName: null,
            resolved: Boolean(colab),
          },
          null // la colaboradora no tiene inversión de Meta asociada
        )
      )
    }
    return { campaign: campaignRows.get(campaignKey)!, ad: adRows.get(adKey)!, colaborador: colabRows.get(colabKey)! }
  }

  for (const appointment of eligibleAppointments) {
    const rows = getRows(appointment)
    for (const row of [rows.campaign, rows.ad, rows.colaborador]) {
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
    const cash = cashForSale(sale.id, collections, refunds, stripePayments)
    totalCash += cash
    const appointment = appointmentForSale(sale, appointmentIndex)
    if (!appointment) continue
    const rows = getRows(appointment)
    for (const row of [rows.campaign, rows.ad, rows.colaborador]) {
      row.sales += 1
      row.bookedRevenue += num(sale.gross_amount)
      row.cashCollected += cash
    }
    salesAttributed += 1
    cashAttributed += cash
    revenueAttributed += num(sale.gross_amount)
  }

  const campaigns = [...campaignRows.values()]
    .map((row) => finalize(row, includeCash))
    .sort((a, b) => b.booked - a.booked)
  const ads = [...adRows.values()].map((row) => finalize(row, includeCash)).sort((a, b) => b.booked - a.booked)
  // Sin map no se fabrican filas: el consumidor que no pide la dimensión la recibe vacía.
  const colaboradores = input.colaboradorDe ? [...colabRows.values()].map((row) => finalize(row, includeCash)) : []
  const shows = eligibleAppointments.filter((appointment) => isAttended(appointment.status)).length
  const noShows = eligibleAppointments.filter((appointment) => isNoShow(appointment.status)).length
  const unresolved = eligibleAppointments.length - shows - noShows
  const rowSpend = campaigns.map((row) => row.spend).filter((value): value is number => value !== null)
  const spend = rowSpend.length > 0 ? rowSpend.reduce((sum, value) => sum + value, 0) : null

  return {
    campaigns,
    ads,
    colaboradores,
    summary: finalize(
      {
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
      },
      includeCash
    ),
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
      estados,
    },
    cashIncluded: includeCash,
  }
}
