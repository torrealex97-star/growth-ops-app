'use client'

import { useEffect, useMemo, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertCircle, CalendarCheck2, ChevronDown, CircleDollarSign, RefreshCw, ShieldCheck } from 'lucide-react'
import { formatCurrency, formatNumber } from '@/lib/utils'
import type { RevenueAttributionResult, RevenueAttributionRow } from '@/lib/meta/revenue-attribution'

type ApiResponse = RevenueAttributionResult & {
  ok: true
  period: { cohort: string; downstream: string; spend: string }
}

type Props = {
  tenant: string
  rangeFrom: string | null
  rangeTo: string | null
  campaignIds: string[]
}

const pct = (value: number | null) => (value === null ? '—' : `${formatNumber(value, { maximumFractionDigits: 1 })}%`)
const times = (value: number | null) =>
  value === null ? '—' : `${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}x`
const ratio = (part: number, total: number) => (total > 0 ? (part / total) * 100 : null)

function CoverageBar({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  const safeValue = Math.max(0, Math.min(100, value ?? 0))
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums text-foreground">{value === null ? 'Sin muestra' : pct(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${safeValue}%` }} />
      </div>
      <p className="text-2xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="dashboard-card p-10 text-center">
      <CalendarCheck2 className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
      <h2 className="mt-3 text-base font-semibold text-foreground">No hay agendas en este periodo</h2>
      <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
        Amplía el rango o sincroniza GHL/Calendly. Un periodo sin agendas no se interpreta como un embudo con cero
        conversión.
      </p>
    </div>
  )
}

export function RevenueAttributionView({ tenant, rangeFrom, rangeTo, campaignIds }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState<'campaigns' | 'ads'>('campaigns')
  const [showDetails, setShowDetails] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams()
    if (rangeFrom) params.set('from', rangeFrom)
    if (rangeTo) params.set('to', rangeTo)
    // Keep the parameter even for an empty scope so the API cannot fall back to
    // campaigns outside the account/filter currently selected in the UI.
    params.set('campaigns', campaignIds.join(','))
    setLoading(true)
    setError(null)
    fetch(`/api/${tenant}/evergreen/meta/revenue-attribution?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const json = (await response.json()) as ApiResponse | { error?: string }
        if (!response.ok) throw new Error('error' in json && json.error ? json.error : 'No se pudo leer la atribución')
        setData(json as ApiResponse)
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return
        setError(reason instanceof Error ? reason.message : 'No se pudo leer la atribución')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [campaignIds, rangeFrom, rangeTo, tenant, version])

  const rows = useMemo(() => data?.[level] ?? [], [data, level])
  const insight = useMemo(() => {
    const comparable = rows.filter((row) => row.booked >= 2 && row.shows + row.noShows > 0 && row.resolved)
    const attendanceLeak = [...comparable].sort((a, b) => (a.showRate ?? 101) - (b.showRate ?? 101))[0]
    const salesLeak = [...comparable]
      .filter((row) => row.shows > 0)
      .sort((a, b) => (a.closeRate ?? 101) - (b.closeRate ?? 101))[0]
    if (attendanceLeak && (attendanceLeak.showRate ?? 100) < 70) {
      return `${attendanceLeak.adName ?? attendanceLeak.campaignName ?? 'Una fuente'} agenda, pero solo asiste el ${pct(attendanceLeak.showRate)}.`
    }
    if (salesLeak && salesLeak.sales === 0) {
      return `${salesLeak.adName ?? salesLeak.campaignName ?? 'Una fuente'} genera shows, pero todavía no ventas atribuidas.`
    }
    return 'No aparece una fuga dominante con muestra suficiente en el periodo seleccionado.'
  }, [rows])

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Cargando embudo de atribución">
        <Skeleton className="h-40 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="dashboard-card flex flex-col items-center gap-3 p-8 text-center" role="alert">
        <AlertCircle className="h-7 w-7 text-red-400" aria-hidden="true" />
        <div>
          <h2 className="font-semibold text-foreground">No se muestran totales parciales</h2>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
        <button
          type="button"
          onClick={() => setVersion((value) => value + 1)}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-foreground hover:bg-muted"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reintentar
        </button>
      </div>
    )
  }

  if (!data || data.summary.booked === 0) return <EmptyState />

  const campaignCoverage = ratio(data.coverage.campaignAttributed, data.coverage.booked)
  const adCoverage = ratio(data.coverage.adAttributed, data.coverage.booked)
  const saleCoverage = ratio(data.coverage.salesAttributed, data.coverage.sales)
  const cashCoverage = ratio(data.coverage.cashAttributed, data.coverage.cashCollected)

  return (
    <div className="space-y-4">
      <section className="dashboard-card overflow-hidden p-5" aria-labelledby="revenue-attribution-title">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.75fr)]">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-brand-400">Resultado de la cohorte</p>
            <div className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-3">
              <div>
                <h2 id="revenue-attribution-title" className="text-sm font-medium text-muted-foreground">
                  Cash cobrado atribuible
                </h2>
                <p className="font-display text-4xl font-semibold tracking-tight text-foreground tabular-nums">
                  {formatCurrency(data.summary.cashCollected)}
                </p>
              </div>
              <div className="pb-1 text-sm text-muted-foreground">
                <span className="font-semibold text-foreground tabular-nums">{data.summary.sales}</span> ventas ·{' '}
                <span className="font-semibold text-foreground tabular-nums">
                  {formatCurrency(data.summary.bookedRevenue)}
                </span>{' '}
                comprometidos
              </div>
            </div>
            <div className="mt-5 rounded-xl border border-border bg-muted/30 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Lectura rápida</p>
              <p className="mt-1 text-sm font-medium text-foreground">{insight}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <CalendarCheck2 className="h-4 w-4 text-brand-400" aria-hidden="true" />
              <p className="mt-3 text-2xl font-semibold text-foreground tabular-nums">{data.summary.booked}</p>
              <p className="text-xs text-muted-foreground">Agendas</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
              <p className="mt-3 text-2xl font-semibold text-foreground tabular-nums">{pct(data.summary.showRate)}</p>
              <p className="text-xs text-muted-foreground">Show rate resuelto</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <CircleDollarSign className="h-4 w-4 text-brand-400" aria-hidden="true" />
              <p className="mt-3 text-2xl font-semibold text-foreground tabular-nums">{pct(data.summary.closeRate)}</p>
              <p className="text-xs text-muted-foreground">Cierre sobre shows</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <p className="text-xs text-muted-foreground">Sin resolver</p>
              <p className="mt-3 text-2xl font-semibold text-foreground tabular-nums">{data.summary.unresolved}</p>
              <p className="text-xs text-muted-foreground">No se tratan como no-show</p>
            </div>
          </div>
        </div>
      </section>

      <section className="dashboard-card p-5" aria-labelledby="coverage-title">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="coverage-title" className="font-semibold text-foreground">
              Cobertura de tracking
            </h2>
            <p className="text-xs text-muted-foreground">
              Indica cuánto puede atribuirse con evidencia, no cuánto vale cero.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowDetails((value) => !value)}
            aria-expanded={showDetails}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-400 hover:text-brand-300"
          >
            {showDetails ? 'Ocultar detalle' : 'Ver definiciones'}
            <ChevronDown className={`h-3.5 w-3.5 transition ${showDetails ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <CoverageBar
            label="Campaña conocida"
            value={campaignCoverage}
            detail={`${data.coverage.campaignAttributed} de ${data.coverage.booked} agendas`}
          />
          <CoverageBar
            label="Anuncio conocido"
            value={adCoverage}
            detail={`${data.coverage.adAttributed} de ${data.coverage.booked} agendas`}
          />
          <CoverageBar
            label="Venta enlazada a agenda"
            value={saleCoverage}
            detail={`${data.coverage.salesAttributed} de ${data.coverage.sales} ventas candidatas`}
          />
          <CoverageBar
            label="Cash enlazado a agenda"
            value={cashCoverage}
            detail={`${formatCurrency(data.coverage.cashAttributed)} de ${formatCurrency(data.coverage.cashCollected)}`}
          />
        </div>
        {showDetails && (
          <div className="mt-4 rounded-xl border border-border bg-muted/20 p-4 text-xs leading-5 text-muted-foreground">
            El periodo selecciona agendas. Asistencia usa solo resultados explícitos; una cita pendiente no es un
            no-show. Las ventas posteriores se enlazan por appointment_id o, si no existe, por una única agenda no
            ambigua del mismo contacto en 90 días. El cash usa Stripe como fuente primaria y cobros internos como
            fallback deduplicado. Un Ad ID ausente permanece sin atribuir.
          </div>
        )}
      </section>

      <section className="dashboard-card overflow-hidden" aria-labelledby="attribution-table-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
          <div>
            <h2 id="attribution-table-title" className="font-semibold text-foreground">
              Embudo por origen
            </h2>
            <p className="text-xs text-muted-foreground">Agenda → asistencia → venta → cobro</p>
          </div>
          <div className="inline-flex rounded-lg border border-border bg-muted/30 p-1 text-xs">
            <button
              type="button"
              onClick={() => setLevel('campaigns')}
              aria-pressed={level === 'campaigns'}
              className="rounded-md px-3 py-1.5 text-muted-foreground aria-pressed:bg-brand-600 aria-pressed:text-white"
            >
              Campañas
            </button>
            <button
              type="button"
              onClick={() => setLevel('ads')}
              aria-pressed={level === 'ads'}
              className="rounded-md px-3 py-1.5 text-muted-foreground aria-pressed:bg-brand-600 aria-pressed:text-white"
            >
              Anuncios
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1240px] text-sm">
            <thead className="bg-muted/20 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Origen</th>
                <th className="px-3 py-3 text-right font-medium">Agendas</th>
                <th className="px-3 py-3 text-right font-medium">Shows</th>
                <th className="px-3 py-3 text-right font-medium">No-show</th>
                <th className="px-3 py-3 text-right font-medium">Pendientes</th>
                <th className="px-3 py-3 text-right font-medium">Show rate</th>
                <th className="px-3 py-3 text-right font-medium">Ventas</th>
                <th className="px-3 py-3 text-right font-medium">Cierre</th>
                <th className="px-3 py-3 text-right font-medium">Facturación</th>
                <th className="px-3 py-3 text-right font-medium">Inversión</th>
                <th className="px-3 py-3 text-right font-medium">Cash ROAS</th>
                <th className="px-5 py-3 text-right font-medium">Cash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row: RevenueAttributionRow) => (
                <tr key={row.key} className="hover:bg-muted/20">
                  <td className="max-w-[320px] px-5 py-4">
                    <p className={`truncate font-medium ${row.resolved ? 'text-foreground' : 'text-amber-300'}`}>
                      {row.adName ??
                        row.campaignName ??
                        (level === 'ads' ? 'Anuncio sin atribuir' : 'Campaña sin atribuir')}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {level === 'ads' && row.campaignName ? `${row.campaignName} · ` : ''}
                      {row.adId ?? row.campaignExternalId ?? 'Sin ID verificable'}
                    </p>
                  </td>
                  <td className="px-3 py-4 text-right tabular-nums text-foreground">{row.booked}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-emerald-300">{row.shows}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-red-300">{row.noShows}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-muted-foreground">{row.unresolved}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-foreground">{pct(row.showRate)}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-foreground">{row.sales}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-foreground">{pct(row.closeRate)}</td>
                  <td className="px-3 py-4 text-right tabular-nums text-foreground">
                    {formatCurrency(row.bookedRevenue)}
                  </td>
                  <td className="px-3 py-4 text-right tabular-nums text-foreground">
                    {row.spend === null ? '—' : formatCurrency(row.spend)}
                  </td>
                  <td className="px-3 py-4 text-right tabular-nums text-foreground">{times(row.cashRoas)}</td>
                  <td className="px-5 py-4 text-right font-medium tabular-nums text-foreground">
                    {formatCurrency(row.cashCollected)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
