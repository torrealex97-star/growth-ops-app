import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { metodoDePlan } from '@/lib/metrics/agregados'
import {
  buildRevenueAttribution,
  type RevenueAppointment,
  type RevenueCollection,
  type RevenueRefund,
  type RevenueSale,
} from '@/lib/meta/revenue-attribution'
import { resolveMetaAttribution } from '@/lib/meta/ad-attribution'
import type { StripePaymentRow } from '@/lib/canonical/cash'
import { fetchAllRows, type RangeQuery } from '@/lib/supabase/paginate'

export const runtime = 'nodejs'

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing', 'adscripcion']
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const BATCH = 200

type AnyRow = Record<string, unknown>

const chunks = <T>(values: T[]) => {
  const out: T[][] = []
  for (let index = 0; index < values.length; index += BATCH) out.push(values.slice(index, index + BATCH))
  return out
}

async function rowsByIds(
  sb: SupabaseClient,
  table: 'sales' | 'collections' | 'refunds' | 'stripe_payments',
  select: string,
  tenantId: string,
  column: string,
  values: string[]
) {
  const unique = [...new Set(values.filter(Boolean))]
  if (unique.length === 0) return []
  const pages = await Promise.all(
    chunks(unique).map((batch) =>
      fetchAllRows<AnyRow>(
        () =>
          sb
            .from(table)
            .select(select)
            .eq('tenant_id', tenantId)
            .in(column, batch)
            .order(column) as unknown as RangeQuery<AnyRow>
      )
    )
  )
  const failed = pages.find((page) => page.error || page.truncated)
  if (failed) throw new Error(failed.error ?? `Lectura incompleta de ${table}`)
  return pages.flatMap((page) => page.rows)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = await requireTenant(tenant)
    if ('error' in auth) return auth.error
    if (!auth.isSuperAdmin && (!auth.role || !ALLOWED_ROLES.includes(auth.role))) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    const from = req.nextUrl.searchParams.get('from')
    const to = req.nextUrl.searchParams.get('to')
    const hasCampaignScope = req.nextUrl.searchParams.has('campaigns')
    const requestedCampaignIds = (req.nextUrl.searchParams.get('campaigns') ?? '')
      .split(',')
      .filter((value) => value.length > 0)
    const selectedCampaignIds = new Set(requestedCampaignIds)
    if ((from && !ISO_DATE.test(from)) || (to && !ISO_DATE.test(to)) || (from && to && from > to)) {
      return NextResponse.json({ error: 'Rango de fechas no válido' }, { status: 400 })
    }
    if (requestedCampaignIds.length > 100 || requestedCampaignIds.some((value) => !UUID.test(value))) {
      return NextResponse.json({ error: 'Filtro de campañas no válido' }, { status: 400 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const tenantId = auth.tenantId

    const [appointmentsResult, campaignsResult, adsResult, dailyResult] = await Promise.all([
      fetchAllRows<AnyRow>(() => {
        let query = sb
          .from('appointments')
          .select(
            'id,contact_id,appointment_datetime,status,utm_source,utm_campaign,raw_payload,attribution_first,attribution_second,attribution_last,attribution_booking,contacts(campaign_id)'
          )
          .eq('tenant_id', tenantId)
        if (from) query = query.gte('appointment_datetime', `${from}T00:00:00Z`)
        if (to) query = query.lte('appointment_datetime', `${to}T23:59:59Z`)
        return query.order('id')
      }),
      fetchAllRows<AnyRow>(() =>
        sb.from('campaigns').select('id,external_id,name').eq('tenant_id', tenantId).eq('provider', 'meta').order('id')
      ),
      fetchAllRows<AnyRow>(() =>
        sb
          .from('campaign_ads')
          .select('external_id,campaign_external_id,name,adset_name')
          .eq('tenant_id', tenantId)
          .order('id')
      ),
      from && to
        ? fetchAllRows<AnyRow>(() =>
            sb
              .from('campaign_daily')
              .select('campaign_id,spend')
              .eq('tenant_id', tenantId)
              .gte('date', from)
              .lte('date', to)
              .order('id')
          )
        : Promise.resolve({ rows: [], error: null, truncated: false }),
    ])

    const sourceResults = [appointmentsResult, campaignsResult, adsResult, dailyResult]
    const failed = sourceResults.find((result) => result.error || result.truncated)
    if (failed) {
      return NextResponse.json(
        { error: failed.error ?? 'La lectura quedó incompleta; no se muestran totales parciales.' },
        { status: 503 }
      )
    }

    const catalog = {
      campaigns: campaignsResult.rows.map((row) => ({
        id: String(row.id),
        external_id: row.external_id ? String(row.external_id) : null,
        name: String(row.name),
      })),
      ads: adsResult.rows.map((row) => ({
        external_id: String(row.external_id),
        campaign_external_id: row.campaign_external_id ? String(row.campaign_external_id) : null,
        name: String(row.name),
        adset_name: row.adset_name ? String(row.adset_name) : null,
      })),
    }
    const allAppointments = appointmentsResult.rows.map((row) => ({
      ...row,
      contacts: Array.isArray(row.contacts) ? (row.contacts[0] ?? null) : row.contacts,
    })) as RevenueAppointment[]
    const appointments = !hasCampaignScope
      ? allAppointments
      : allAppointments.filter((appointment) => {
          const resolved = resolveMetaAttribution(appointment, catalog)
          return !!resolved.campaign.internalId && selectedCampaignIds.has(resolved.campaign.internalId)
        })
    const appointmentIds = appointments.map((appointment) => appointment.id)
    const contactIds = appointments.map((appointment) => appointment.contact_id).filter((id): id is string => !!id)

    const [salesByAppointment, salesByContact] = await Promise.all([
      rowsByIds(
        sb,
        'sales',
        'id,appointment_id,contact_id,sale_date,gross_amount,status,reservation_completed_at,payment_plans(method)',
        tenantId,
        'appointment_id',
        appointmentIds
      ),
      rowsByIds(
        sb,
        'sales',
        'id,appointment_id,contact_id,sale_date,gross_amount,status,reservation_completed_at,payment_plans(method)',
        tenantId,
        'contact_id',
        contactIds
      ),
    ])
    const salesMap = new Map([...salesByAppointment, ...salesByContact].map((sale) => [String(sale.id), sale]))
    const sales = [...salesMap.values()].map((sale) => ({
      ...sale,
      payment_plan_method: metodoDePlan(sale),
    })) as RevenueSale[]

    const collections = await rowsByIds(
      sb,
      'collections',
      'id,sale_id,payment_reference,gross_amount,status,collected_at',
      tenantId,
      'sale_id',
      sales.map((sale) => sale.id)
    )
    const collectionIds = collections.map((collection) => String(collection.id))
    const refunds = await rowsByIds(
      sb,
      'refunds',
      'collection_id,sale_id,refund_date,gross_refund_amount,status',
      tenantId,
      'collection_id',
      collectionIds
    )
    const references = collections
      .map((collection) => collection.payment_reference)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    const [stripeByPayment, stripeByCharge] = await Promise.all([
      rowsByIds(
        sb,
        'stripe_payments',
        'payment_id,charge_id,amount,refunded_amount,status,paid_at,customer_email,refunded_at,currency,fx_rate_to_eur',
        tenantId,
        'payment_id',
        references
      ),
      rowsByIds(
        sb,
        'stripe_payments',
        'payment_id,charge_id,amount,refunded_amount,status,paid_at,customer_email,refunded_at,currency,fx_rate_to_eur',
        tenantId,
        'charge_id',
        references
      ),
    ])
    const stripePayments = [
      ...new Map([...stripeByPayment, ...stripeByCharge].map((row) => [row.payment_id, row])).values(),
    ]

    const campaignSpend: Record<string, number> = {}
    for (const row of dailyResult.rows) {
      const campaignId = String(row.campaign_id ?? '')
      if (campaignId) campaignSpend[campaignId] = (campaignSpend[campaignId] ?? 0) + Number(row.spend ?? 0)
    }

    const result = buildRevenueAttribution({
      appointments,
      sales,
      collections: collections as RevenueCollection[],
      refunds: refunds as RevenueRefund[],
      stripePayments: stripePayments as StripePaymentRow[],
      catalog,
      campaignSpend: from && to ? campaignSpend : undefined,
    })

    return NextResponse.json({
      ok: true,
      ...result,
      period: {
        from,
        to,
        cohort: 'appointment_datetime',
        downstream: 'hasta hoy, máximo 90 días cuando la venta no tiene appointment_id explícito',
        spend: from && to ? 'campaign_daily del mismo periodo' : 'no comparable sin periodo',
      },
    })
  } catch (error) {
    console.error('[api/meta/revenue-attribution GET]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error inesperado' }, { status: 500 })
  }
}
