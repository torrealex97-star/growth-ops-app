import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { fetchMetaAdInsights, resolveMetaConfigs } from '@/lib/meta/client'
import { MetaError } from '@/lib/meta/errors'
import type { AdRangeRow } from '@/lib/types/database'

export const runtime = 'nodejs'
export const maxDuration = 60

const ALLOWED_ROLES = ['super_admin', 'admin', 'director', 'manager', 'marketing', 'adscripcion']
const YMD = /^\d{4}-\d{2}-\d{2}$/

// Métricas por anuncio para el MISMO periodo que el resto de la pantalla de Campañas.
// `campaign_ads` solo guarda el total de los últimos 90 días, así que no sirve para filtrar por
// fechas: se pide a Meta el rango exacto. Sin from/to = histórico completo (preset «Todo»).
// Las cuentas son las seleccionadas en Integraciones (resolveMetaConfigs falla si no hay selección).
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!t.role || !ALLOWED_ROLES.includes(t.role)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const from = req.nextUrl.searchParams.get('from')
  const to = req.nextUrl.searchParams.get('to')
  if ((from && !YMD.test(from)) || (to && !YMD.test(to)) || !!from !== !!to) {
    return NextResponse.json({ error: 'Rango de fechas inválido' }, { status: 400 })
  }

  try {
    const configs = await resolveMetaConfigs(await getTenantConfigWithFallback(t.tenantId))
    const failures: string[] = []
    const porCuenta = await Promise.all(
      configs.map(async (cfg) => {
        try {
          const filas = await fetchMetaAdInsights(cfg, from && to ? { since: from, until: to } : 'maximum')
          return filas.map((i): AdRangeRow => ({
            external_id: i.ad_id,
            name: i.ad_name,
            adset_name: i.adset_name,
            campaign_external_id: i.campaign_id,
            account_id: cfg.accountId,
            account_name: cfg.accountName ?? null,
            spend: i.spend,
            impressions: i.impressions,
            clicks: i.clicks,
            leads: i.leads,
            followers: i.followers,
          }))
        } catch (err) {
          failures.push(`Cuenta ${cfg.accountName || cfg.accountId}: ${err instanceof Error ? err.message : 'error'}`)
          return []
        }
      })
    )
    // Si fallan TODAS las cuentas no hay datos que enseñar: devolver una lista vacía se leería como
    // «cero anuncios en el periodo», que es un dato falso.
    if (failures.length === configs.length) {
      return NextResponse.json({ error: failures.join(' · ') }, { status: 502 })
    }
    return NextResponse.json({ ok: true, ads: porCuenta.flat(), failures })
  } catch (err) {
    const status = err instanceof MetaError ? 409 : 500
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status })
  }
}
