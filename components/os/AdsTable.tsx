'use client'

import { useEffect, useMemo, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { createClient } from '@/lib/supabase/client'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/utils'
import type { AdRangeRow, Campaign, CampaignAd } from '@/lib/types/database'
import { AlertTriangle, Megaphone, RefreshCw } from 'lucide-react'
import { SearchBox, normalizeText } from '@/components/ui/search-box'
import { useTenantId } from '@/lib/tenant-context'
import type { RevenueAttributionRow } from '@/lib/meta/revenue-attribution'

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null)

const statusBadge = (s: string | null) => {
  if (s === 'activa') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
  if (s === 'pausada') return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
  return 'bg-muted/30 text-muted-foreground border-border/30'
}

type Props = {
  tenant: string
  campaigns: Campaign[]
  accounts: { id: string; name: string }[]
  version: number // se incrementa tras sincronizar anuncios → refetch
  /** Selección de cuentas de Meta de Integraciones: los anuncios de otras cuentas no se muestran. */
  incluyeCuenta: (accountId: string | null | undefined) => boolean
  // Filtros globales de la pantalla de Campañas: los mismos que usan Embudo CRM, Análisis Meta y Campañas.
  rangeFrom: string | null
  rangeTo: string | null
  accountFilter: string
  selectedCampaignIds: string[]
}

type Fila = AdRangeRow & { campaign_id: string | null; status: string | null }

type CrmEstado = 'cargando' | 'ok' | 'error'

// Vista a nivel de ANUNCIO para el periodo, cuenta y campañas elegidos en la barra global.
// Las métricas salen de Meta para el rango exacto; `campaign_ads` solo aporta el estado del anuncio.
export function AdsTable({
  tenant,
  campaigns,
  accounts,
  version,
  incluyeCuenta,
  rangeFrom,
  rangeTo,
  accountFilter,
  selectedCampaignIds,
}: Props) {
  const tenantId = useTenantId()
  const [estado, setEstado] = useState<Map<string, CampaignAd>>(new Map())
  const [rango, setRango] = useState<AdRangeRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [avisos, setAvisos] = useState<string[]>([])
  const [search, setSearch] = useState('')
  // CRM por anuncio (agendas/asistencias/cierres): sale de la MISMA atribución canónica que
  // «Análisis Meta» (revenue-attribution), que ya resuelve cada cita al anuncio con el orden de
  // toques completo. Se une por external_id; un anuncio sin fila de atribución se pinta «—»:
  // no tiene agendas atribuidas conocidas, que es distinto de «cero agendas».
  const [crmEstado, setCrmEstado] = useState<CrmEstado>('cargando')
  const [crmFilas, setCrmFilas] = useState<Map<string, RevenueAttributionRow>>(new Map())
  const [crmCobertura, setCrmCobertura] = useState<{ booked: number; adAttributed: number } | null>(null)
  const [crmError, setCrmError] = useState<string | null>(null)
  const [crmIntento, setCrmIntento] = useState(0)

  const campaignNameById = useMemo(() => new Map(campaigns.map((c) => [c.id, c.name])), [campaigns])
  const campaignIdByExt = useMemo(
    () => new Map(campaigns.filter((c) => c.external_id).map((c) => [c.external_id as string, c.id])),
    [campaigns]
  )

  useEffect(() => {
    let cancel = false
    createClient()
      .from('campaign_ads')
      .select('*')
      .eq('tenant_id', tenantId)
      .then(({ data }) => {
        if (!cancel) setEstado(new Map(((data as CampaignAd[]) || []).map((a) => [a.external_id, a])))
      })
    return () => {
      cancel = true
    }
  }, [tenantId, version])

  const conRango = !!(rangeFrom && rangeTo)

  useEffect(() => {
    const ctrl = new AbortController()
    setCrmEstado('cargando')
    setCrmError(null)
    const params = new URLSearchParams()
    if (conRango) {
      params.set('from', rangeFrom as string)
      params.set('to', rangeTo as string)
    }
    // Sin filtro de campañas elegido NO se envía el parámetro: el endpoint debe mirar todas.
    if (selectedCampaignIds.length > 0) params.set('campaigns', selectedCampaignIds.join(','))
    // Aquí solo se pintan agendas/asistencias/cierres: metrics=bookings evita las lecturas de cash
    // (collections/refunds/stripe), que son las caras cuando la cohorte de agendas es grande.
    params.set('metrics', 'bookings')
    fetch(`/api/${tenant}/evergreen/meta/revenue-attribution?${params}`, { signal: ctrl.signal })
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
        const ads = (json.ads ?? []) as RevenueAttributionRow[]
        setCrmFilas(new Map(ads.filter((a) => a.adId).map((a) => [a.adId as string, a])))
        setCrmCobertura({ booked: json.coverage?.booked ?? 0, adAttributed: json.coverage?.adAttributed ?? 0 })
        setCrmEstado('ok')
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        setCrmEstado('error')
        setCrmError(e instanceof Error ? e.message : 'No se pudo leer el CRM por anuncio')
      })
    return () => ctrl.abort()
  }, [tenant, conRango, rangeFrom, rangeTo, selectedCampaignIds, version, crmIntento])

  useEffect(() => {
    const ctrl = new AbortController()
    setRango(null)
    setError(null)
    const qs = conRango ? `?from=${rangeFrom}&to=${rangeTo}` : ''
    fetch(`/api/${tenant}/evergreen/meta/ads-range${qs}`, { signal: ctrl.signal })
      .then(async (res) => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
        setRango(json.ads as AdRangeRow[])
        setAvisos(json.failures ?? [])
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        setError(e instanceof Error ? e.message : 'No se pudieron leer los anuncios de Meta')
      })
    return () => ctrl.abort()
  }, [tenant, conRango, rangeFrom, rangeTo, version])

  const filas = useMemo<Fila[]>(() => {
    if (!rango) return []
    const q = normalizeText(search.trim())
    return rango
      .map((r) => {
        const guardado = estado.get(r.external_id)
        return {
          ...r,
          campaign_id: campaignIdByExt.get(r.campaign_external_id) ?? guardado?.campaign_id ?? null,
          status: guardado?.status ?? null,
        }
      })
      .filter(
        (a) =>
          incluyeCuenta(a.account_id) &&
          (accountFilter === 'all' || a.account_id === accountFilter) &&
          (selectedCampaignIds.length === 0 || (!!a.campaign_id && selectedCampaignIds.includes(a.campaign_id))) &&
          (q === '' || normalizeText(a.name).includes(q) || normalizeText(a.adset_name).includes(q))
      )
      .sort((a, b) => b.spend - a.spend)
  }, [rango, estado, campaignIdByExt, incluyeCuenta, accountFilter, selectedCampaignIds, search])

  const totalSpend = filas.reduce((s, a) => s + a.spend, 0)
  const totalFollowers = filas.reduce((s, a) => s + a.followers, 0)
  const costPerFollower = div(totalSpend, totalFollowers)

  // Las columnas CRM solo aparecen cuando existe atribución a nivel de anuncio con contenido:
  // si nadie tiene agendas atribuidas, tres columnas de guiones serían ruido, no información.
  const mostrarCrm = crmEstado === 'ok' && [...crmFilas.values()].some((fila) => fila.booked > 0 || fila.sales > 0)
  const sinAtribuir = crmCobertura && crmCobertura.booked - crmCobertura.adAttributed

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>No se pudieron cargar los anuncios de este periodo: {error}</span>
      </div>
    )
  }
  if (!rango) return <Skeleton className="h-64" />

  return (
    <div className="space-y-4">
      <SearchBox value={search} onChange={setSearch} placeholder="Buscar anuncio o conjunto…" className="w-full" />

      {avisos.length > 0 && <p className="text-xs text-yellow-400">Datos incompletos: {avisos.join(' · ')}</p>}

      {crmEstado === 'error' && (
        <div className="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>CRM por anuncio ilegible: {crmError}. La tabla muestra solo métricas de Meta.</span>
          <button
            type="button"
            onClick={() => setCrmIntento((n) => n + 1)}
            className="ml-auto inline-flex items-center gap-1 rounded border border-yellow-500/30 px-2 py-1 hover:bg-yellow-500/10"
          >
            <RefreshCw className="h-3 w-3" /> Reintentar
          </button>
        </div>
      )}

      {/* La nota de cobertura NO depende de mostrarCrm: aunque NINGÚN anuncio resuelva (el caso
          de utm_content con nombres duplicados en Meta, que vuelven el resolver 'ambigua'), el
          hueco se declara en pantalla en vez de ocultar columnas y nota a la vez en silencio. */}
      {crmEstado === 'ok' && sinAtribuir !== null && sinAtribuir > 0 && (
        <p className="text-xs text-muted-foreground">
          {sinAtribuir} de {crmCobertura?.booked} agendas del periodo no llegan a un anuncio concreto (nombres
          duplicados en Meta): no se reparten ni se inventan
          {mostrarCrm ? '; quedan fuera de estas columnas.' : '; las columnas CRM quedan ocultas.'}
        </p>
      )}

      {/* Una superficie con divisores en vez de 4 cards idénticas — mismo patrón que la
          cabecera de Campañas, para no repetir "grid de KPI cards" en cada pantalla. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-border rounded-lg border border-border bg-card/30">
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">Anuncios</p>
          <p className="mt-1 text-xl font-semibold text-foreground tabular-nums">{formatNumber(filas.length)}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">Gasto</p>
          <p className="mt-1 text-xl font-semibold text-foreground tabular-nums">{formatCurrency(totalSpend)}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">Seguidores</p>
          <p className="mt-1 text-xl font-semibold text-foreground tabular-nums">{formatNumber(totalFollowers)}</p>
        </div>
        <div className="px-4 py-3">
          <p className="text-xs text-muted-foreground">€ / Seguidor</p>
          <p className="mt-1 text-xl font-semibold text-foreground tabular-nums">
            {costPerFollower === null ? '—' : formatCurrency(costPerFollower)}
          </p>
        </div>
      </div>

      {filas.length === 0 ? (
        <div className="bg-card/50 border border-border rounded-lg p-10 text-center">
          <Megaphone className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">Ningún anuncio con actividad para estos filtros.</p>
        </div>
      ) : (
        <div className="bg-card/50 border border-border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="sticky top-0 z-10 bg-card border-b border-border text-left text-muted-foreground text-xs uppercase">
                <th className="px-4 py-3">Anuncio</th>
                <th className="px-4 py-3">Campaña</th>
                {accounts.length > 1 && <th className="px-4 py-3">Cuenta</th>}
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3 text-right">Gasto</th>
                <th className="px-4 py-3 text-right">Leads</th>
                <th className="px-4 py-3 text-right">Seguidores</th>
                <th className="px-4 py-3 text-right">€/Seg</th>
                <th className="px-4 py-3 text-right">CPC</th>
                <th className="px-4 py-3 text-right">CTR</th>
                {mostrarCrm && (
                  <>
                    <th className="px-4 py-3 text-right">Agendas</th>
                    <th className="px-4 py-3 text-right">Asistencias</th>
                    <th className="px-4 py-3 text-right">Cierres</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filas.map((a) => {
                const cpc = div(a.spend, a.clicks)
                const ctr = div(a.clicks, a.impressions)
                const cpf = div(a.spend, a.followers)
                const campana = a.campaign_id ? campaignNameById.get(a.campaign_id) : undefined
                const crm = crmFilas.get(a.external_id)
                return (
                  <tr key={a.external_id} className="border-b border-border/60 hover:bg-muted/30">
                    <td className="px-4 py-3 text-foreground max-w-[280px]">
                      <div className="truncate" title={a.name}>
                        {a.name}
                      </div>
                      {a.adset_name && (
                        <div className="text-2xs text-muted-foreground truncate" title={a.adset_name}>
                          {a.adset_name}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[200px]">
                      <span className="truncate block" title={campana ?? ''}>
                        {campana ?? '—'}
                      </span>
                    </td>
                    {accounts.length > 1 && (
                      <td className="px-4 py-3 text-2xs text-muted-foreground">{a.account_name || a.account_id}</td>
                    )}
                    <td className="px-4 py-3">
                      <span className={`text-2xs px-1.5 py-0.5 rounded border ${statusBadge(a.status)}`}>
                        {a.status || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-foreground tabular-nums">{formatCurrency(a.spend)}</td>
                    <td className="px-4 py-3 text-right text-foreground tabular-nums">{formatNumber(a.leads)}</td>
                    <td className="px-4 py-3 text-right text-foreground tabular-nums">
                      {a.followers > 0 ? formatNumber(a.followers) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                      {cpf === null ? '—' : formatCurrency(cpf)}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                      {cpc === null ? '—' : formatCurrency(cpc)}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground tabular-nums">
                      {formatPercent(ctr === null ? null : ctr * 100, 2)}
                    </td>
                    {mostrarCrm && (
                      <>
                        <td className="px-4 py-3 text-right text-foreground tabular-nums">
                          {crm ? formatNumber(crm.booked) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground tabular-nums">
                          {crm ? formatNumber(crm.shows) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-foreground tabular-nums">
                          {crm ? formatNumber(crm.sales) : '—'}
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
