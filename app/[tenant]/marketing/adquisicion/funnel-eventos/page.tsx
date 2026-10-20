'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTenant } from '@/lib/tenant-context'
import { ConnectedFunnel } from '@/components/os/ConnectedFunnel'
import { PeriodFilterBar } from '@/components/os/PeriodFilterBar'
import { DEFAULT_PERIOD, getPeriodRange, toDateInputValue, type PeriodPreset } from '@/lib/filters/period'
import { formatNumber, formatPercent } from '@/lib/utils'
import type { ResultadoFunnelEventos } from '@/lib/analytics/funnel-eventos'

type Respuesta = ResultadoFunnelEventos & { truncated: boolean; eventosLeidos: number; ventanaHoras: number }

const VENTANAS = [
  { horas: 24, label: '24 horas' },
  { horas: 72, label: '3 días' },
  { horas: 168, label: '7 días' },
  { horas: 720, label: '30 días' },
] as const

export default function FunnelEventosPage() {
  const tenant = useTenant()
  const [preset, setPreset] = useState<PeriodPreset>(DEFAULT_PERIOD)
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [ventana, setVentana] = useState<number>(72)
  const [data, setData] = useState<Respuesta | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const range = useMemo(() => getPeriodRange(preset, customFrom, customTo), [preset, customFrom, customTo])
  const desde = range.from ? toDateInputValue(range.from) : ''
  const hasta = range.to ? toDateInputValue(range.to) : ''

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams({ ventana: String(ventana) })
    if (desde) qs.set('from', desde)
    if (hasta) qs.set('to', hasta)
    fetch(`/api/${tenant}/evergreen/funnel-eventos?${qs}`, { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.error ?? 'No se pudo cargar el funnel')
        setData(body as Respuesta)
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return
        setData(null)
        setError(e instanceof Error ? e.message : 'No se pudo cargar el funnel')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [tenant, desde, hasta, ventana])

  const stages = (data?.pasos ?? []).map((p) => ({
    label: p.label,
    value: p.personas,
    conversion: p.conversionDesdeAnterior,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-foreground">Funnel por eventos</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Personas que recorren los pasos en orden desde su primera visita, dentro de la ventana elegida. Solo cuenta lo
          que llega por el tracking propio: una persona que salta un paso (p. ej. agenda sin visita registrada) no
          aparece en los siguientes.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
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
          className="min-w-[280px] flex-1"
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Ventana para completar el funnel</span>
          <select
            value={ventana}
            onChange={(e) => setVentana(Number(e.target.value))}
            className="h-9 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground focus:border-brand-500 focus:outline-none"
          >
            {VENTANAS.map((v) => (
              <option key={v.horas} value={v.horas}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-border bg-muted p-4 text-sm text-foreground">
          {error}
        </div>
      )}
      {data?.truncated && (
        <div role="status" className="rounded-lg border border-border bg-muted p-4 text-sm text-foreground">
          Hay más eventos de los que se pueden leer de una vez ({formatNumber(data.eventosLeidos)} leídos): las cifras
          pueden quedarse cortas. Acota el periodo.
        </div>
      )}

      <div className="dashboard-card p-5">
        {!error && !loading && data && data.entraron === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Sin eventos de tracking en este periodo. Si acabas de instalar el script, espera a las primeras visitas.
          </p>
        ) : (
          <ConnectedFunnel stages={stages} loading={loading} />
        )}
      </div>

      {!loading && data && data.entraron > 0 && (
        <div className="dashboard-card overflow-x-auto p-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-2xs uppercase tracking-wider text-muted-foreground">
                <th className="py-2 text-left font-medium">Paso</th>
                <th className="py-2 text-right font-medium">Personas</th>
                <th className="py-2 text-right font-medium">Desde el paso anterior</th>
                <th className="py-2 text-right font-medium">Desde el inicio</th>
                <th className="py-2 text-right font-medium">Abandonan</th>
              </tr>
            </thead>
            <tbody>
              {data.pasos.map((p) => (
                <tr key={p.id} className="border-b border-border/50 last:border-0">
                  <td className="py-2.5 text-foreground">{p.label}</td>
                  <td className="py-2.5 text-right text-foreground">{formatNumber(p.personas)}</td>
                  <td className="py-2.5 text-right text-foreground">
                    {p.conversionDesdeAnterior === null ? '—' : formatPercent(p.conversionDesdeAnterior, 1)}
                  </td>
                  <td className="py-2.5 text-right text-foreground">
                    {p.conversionDesdeTope === null ? '—' : formatPercent(p.conversionDesdeTope, 1)}
                  </td>
                  <td className="py-2.5 text-right text-foreground">
                    {p.abandonados > 0 ? formatNumber(p.abandonados) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.sinIdentidad > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {formatNumber(data.sinIdentidad)} eventos sin visitante ni contacto no se pueden asignar a ninguna persona
              y quedan fuera.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
