import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { PERMISSIONS, type AppRole } from '@/lib/auth/permissions'

export const runtime = 'nodejs'

const MAX_IDS = 300
const META_ID = /^\d{10,30}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type CatalogRequest = {
  campaignExternalIds?: unknown
  campaignInternalIds?: unknown
  adExternalIds?: unknown
}

function ids(value: unknown, pattern: RegExp): string[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_IDS) return null
  const normalized = [...new Set(value)]
  if (!normalized.every((item): item is string => typeof item === 'string' && pattern.test(item))) return null
  return normalized
}

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

/**
 * Devuelve solo etiquetas mínimas de Meta para las agendas que ya están en pantalla. La ruta
 * server-side evita abrir por RLS el gasto y las métricas publicitarias a todos los roles de ventas.
 */
export async function POST(request: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!auth.role || !PERMISSIONS.canViewAppointments(auth.role as AppRole)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as CatalogRequest | null
  if (!body) return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  const campaignExternalIds = ids(body.campaignExternalIds, META_ID)
  const campaignInternalIds = ids(body.campaignInternalIds, UUID)
  const adExternalIds = ids(body.adExternalIds, META_ID)
  if (!campaignExternalIds || !campaignInternalIds || !adExternalIds) {
    return NextResponse.json({ error: `Identificadores inválidos (máximo ${MAX_IDS} por tipo)` }, { status: 400 })
  }

  try {
    const sb = serviceClient()
    const emptyCampaigns = Promise.resolve({ data: [], error: null })
    const byExternal = campaignExternalIds.length
      ? sb
          .from('campaigns')
          .select('id,external_id,name')
          .eq('tenant_id', auth.tenantId)
          .in('external_id', campaignExternalIds)
      : emptyCampaigns
    const byInternal = campaignInternalIds.length
      ? sb.from('campaigns').select('id,external_id,name').eq('tenant_id', auth.tenantId).in('id', campaignInternalIds)
      : emptyCampaigns
    const ads = adExternalIds.length
      ? sb
          .from('campaign_ads')
          .select('external_id,campaign_external_id,name,adset_name')
          .eq('tenant_id', auth.tenantId)
          .in('external_id', adExternalIds)
      : Promise.resolve({ data: [], error: null })

    const [externalResult, internalResult, adsResult] = await Promise.all([byExternal, byInternal, ads])
    const queryError = externalResult.error ?? internalResult.error ?? adsResult.error
    if (queryError) throw queryError

    const campaigns = new Map<string, { id: string; external_id: string | null; name: string }>()
    for (const row of [...(externalResult.data ?? []), ...(internalResult.data ?? [])]) campaigns.set(row.id, row)

    return NextResponse.json(
      { campaigns: [...campaigns.values()], ads: adsResult.data ?? [] },
      { headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=300' } }
    )
  } catch {
    return NextResponse.json(
      { error: 'No se pudo resolver la atribución publicitaria', requestId: auth.requestId },
      { status: 500 }
    )
  }
}
