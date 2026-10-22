'use client'

import { useEffect, useState } from 'react'
import { useTenant } from '@/lib/tenant-context'
import { Skeleton } from '@/components/ui/skeleton'
import { formatNumber, formatPercent } from '@/lib/utils'
import type { MetricasConversaciones } from '@/lib/conversaciones/metricas'

const SIN_DATOS = 'Sin datos'
const pct = (v: number | null) => (v === null ? SIN_DATOS : formatPercent(v, 0))
const min = (v: number | null) =>
  v === null
    ? SIN_DATOS
    : v < 60
      ? `${formatNumber(Math.round(v))} min`
      : `${formatNumber(Math.round((v / 60) * 10) / 10)} h`

export default function MetricasTab() {
  const tenant = useTenant()
  const [dias, setDias] = useState(30)
  const [datos, setDatos] = useState<{ metricas: MetricasConversaciones; parcial: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setDatos(null)
    setError(null)
    ;(async () => {
      const res = await fetch(`/api/${tenant}/evergreen/conversaciones/metricas?dias=${dias}`)
      const body = await res.json().catch(() => ({}))
      if (!vivo) return
      if (!res.ok) setError(body.error ?? 'No se pudieron cargar las métricas')
      else setDatos(body)
    })()
    return () => {
      vivo = false
    }
  }, [tenant, dias])

  const m = datos?.metricas
  const tarjetas: [string, string, string][] = m
    ? [
        ['Conversaciones con mensaje del lead', formatNumber(m.conversaciones), ''],
        ['Respondidas', pct(m.respondidas), 'con respuesta de una persona o de la IA'],
        ['Primera respuesta (equipo)', min(m.primeraRespuestaMin.humano), 'mediana'],
        ['Primera respuesta (IA)', min(m.primeraRespuestaMin.ia), 'mediana'],
        ['Atendidas por la IA', formatNumber(m.atendidasPorIA), `${formatNumber(m.enviosIA)} envíos autónomos`],
        ['Traspaso a una persona', pct(m.traspasoPct), 'de lo que tocó el agente'],
        [
          'Borradores',
          `${m.borradores.aprobados} aprobados · ${m.borradores.descartados} descartados`,
          `${m.borradores.pendientes} pendientes`,
        ],
        [
          'Citas creadas después del primer mensaje',
          m.agendasPosteriores === null ? SIN_DATOS : formatNumber(m.agendasPosteriores),
          'de los leads vinculados',
        ],
      ]
    : []

  return (
    <div className="max-w-4xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Métricas de conversaciones</h2>
        <p className="text-sm text-muted-foreground">
          Cómo se atienden los mensajes. Las métricas comerciales (show rate, cierre…) siguen en Analítica con su
          fórmula canónica.
        </p>
      </div>
      <div className="flex gap-1.5" role="tablist" aria-label="Periodo">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={dias === d}
            onClick={() => setDias(d)}
            className={`rounded-full border px-3 py-1 text-xs ${dias === d ? 'border-brand-500 bg-brand-500/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            {d} días
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400">
          {error}
        </p>
      ) : !datos ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          {datos.parcial ? (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-400">
              Hay más conversaciones o mensajes de los que se leen de una vez: las cifras son parciales. Reduce el
              periodo.
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {tarjetas.map(([titulo, valor, nota]) => (
              <div key={titulo} className="rounded-lg border border-border bg-card/50 p-4">
                <p className="text-xs text-muted-foreground">{titulo}</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{valor}</p>
                {nota ? <p className="text-xs text-muted-foreground">{nota}</p> : null}
              </div>
            ))}
          </div>
          {m && m.motivosTraspaso.length > 0 ? (
            <section className="rounded-lg border border-border p-4" aria-label="Motivos de traspaso">
              <h2 className="text-sm font-semibold text-foreground">Por qué pasa a una persona</h2>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {m.motivosTraspaso.map((x) => (
                  <li key={x.motivo} className="flex justify-between">
                    <span>{x.motivo.replace(/_/g, ' ')}</span>
                    <span className="text-foreground">{x.n}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}
