'use client'

import { useEffect, useMemo, useState } from 'react'
import { Users, Activity, FileText, Target } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { addDaysYmd, businessToday } from '@/lib/dates/business'
import { KPICard } from '@/components/os/DashboardKPICard'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import { DEFAULT_PERIOD, getPeriodRange, toDateInputValue, type PeriodPreset } from '@/lib/filters/period'
import { pctDelta } from '@/lib/analytics'
import { formatNumber, formatPercent } from '@/lib/utils'
import type { FilaConteo, ResumenTrafico } from '@/lib/analytics/trafico-web'

type Respuesta = {
  actual: ResumenTrafico
  anterior: ResumenTrafico
  truncated: boolean
  periodo: { from: string; to: string; prevFrom: string; prevTo: string }
}

function deltaProps(curr: number | null, prev: number | null) {
  if (curr === null || prev === null) return {}
  const d = pctDelta(curr, prev)
  if (d === null) return {}
  return {
    delta: Math.abs(d),
    deltaType: d > 0 ? ('up' as const) : d < 0 ? ('down' as const) : ('neutral' as const),
    deltaSentiment: d > 0 ? ('positive' as const) : d < 0 ? ('negative' as const) : ('neutral' as const),
  }
}

function TopLista({ titulo, filas, vacio }: { titulo: string; filas: FilaConteo[]; vacio: string }) {
  return (
    <div className="dashboard-card p-5">
      <h3 className="mb-3 text-sm font-semibold text-foreground">{titulo}</h3>
      {filas.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{vacio}</p>
      ) : (
        <ul className="space-y-2">
          {filas.map((f) => (
            <li key={f.clave} className="text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="max-w-[70%] truncate text-foreground" title={f.clave}>
                  {f.clave}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatNumber(f.visitantes)} · {formatPercent(f.porcentaje, 0)}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.min(100, f.porcentaje)}%`, background: 'hsl(var(--brand-500) / 0.7)' }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function TraficoWebPage() {
  const tenant = useTenant()
  const [preset, setPreset] = useState<PeriodPreset>(DEFAULT_PERIOD)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [data, setData] = useState<Respuesta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const range = useMemo(() => getPeriodRange(preset, customFrom, customTo), [preset, customFrom, customTo])
  // «Todo el periodo» no tiene fechas: las APIs aceptan como máximo 12 meses, así que se pide ese rango
  // explícito y se avisa en pantalla (antes caía en silencio a los últimos 30 días del servidor).
  const hoy = businessToday()
  const todoElPeriodo = preset === 'all'
  const desde = todoElPeriodo ? addDaysYmd(hoy, -364) : range.from ? toDateInputValue(range.from) : ''
  const hasta = todoElPeriodo ? hoy : range.to ? toDateInputValue(range.to) : ''

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams()
    if (desde) qs.set('from', desde)
    if (hasta) qs.set('to', hasta)
    fetch(`/api/${tenant}/evergreen/trafico-web?${qs}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.error ?? 'No se pudo cargar el tráfico')
        setData(body as Respuesta)
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setData(null)
        setError(e instanceof Error ? e.message : 'No se pudo cargar el tráfico')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [tenant, desde, hasta])

  const a = data?.actual
  const p = data?.anterior
  const comparar = data ? `vs ${data.periodo.prevFrom} – ${data.periodo.prevTo}` : undefined

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-foreground">Tráfico web</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Visitas del tracking propio, sin cookies de terceros. Se cuentan personas y sesiones distintas, no recargas.
          La fuente de cada persona es la de su primera visita del periodo. Los bots no se pueden separar todavía.
        </p>
      </div>

      <PeriodFilterBar
        preset={preset}
        onPresetChange={setPreset}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
        onClear={() => {
          setPreset(DEFAULT_PERIOD)
          setCustomFrom('')
          setCustomTo('')
        }}
        hasActiveFilters={preset !== DEFAULT_PERIOD}
      />

      {todoElPeriodo && (
        <p className="text-xs text-muted-foreground">
          «Todo el periodo» muestra los últimos 12 meses ({desde} – {hasta}).
        </p>
      )}

      {error && (
        <div role="alert" className="rounded-lg border border-border bg-muted p-4 text-sm text-foreground">
          {error}
        </div>
      )}
      {data?.truncated && (
        <div role="status" className="rounded-lg border border-border bg-muted p-4 text-sm text-foreground">
          Hay más eventos de los que se pueden leer de una vez: las cifras pueden quedarse cortas. Acota el periodo.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPICard
          title="Visitantes"
          value={a ? formatNumber(a.visitantes) : '—'}
          icon={Users}
          loading={loading}
          compareLabel={comparar}
          {...deltaProps(a?.visitantes ?? null, p?.visitantes ?? null)}
        />
        <KPICard
          title="Sesiones"
          value={a ? formatNumber(a.sesiones) : '—'}
          icon={Activity}
          loading={loading}
          compareLabel={comparar}
          {...deltaProps(a?.sesiones ?? null, p?.sesiones ?? null)}
        />
        <KPICard
          title="Páginas vistas"
          value={a ? formatNumber(a.paginasVistas) : '—'}
          icon={FileText}
          loading={loading}
          compareLabel={comparar}
          {...deltaProps(a?.paginasVistas ?? null, p?.paginasVistas ?? null)}
        />
        <KPICard
          title="Conversión a lead"
          value={a?.conversion == null ? '—' : formatPercent(a.conversion, 1)}
          icon={Target}
          loading={loading}
          compareLabel={comparar}
          {...deltaProps(a?.conversion ?? null, p?.conversion ?? null)}
        />
      </div>

      {!loading && !error && a && a.visitantes === 0 ? (
        <div className="dashboard-card p-5">
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin visitas registradas en este periodo. Si acabas de instalar el script de tracking, espera a las primeras
            visitas.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TopLista
            titulo="Fuentes de tráfico"
            filas={a?.topFuentes ?? []}
            vacio={loading ? 'Cargando…' : 'Sin fuentes todavía.'}
          />
          <TopLista
            titulo="Páginas más vistas"
            filas={a?.topPaginas ?? []}
            vacio={loading ? 'Cargando…' : 'Sin páginas todavía.'}
          />
        </div>
      )}
    </div>
  )
}
