'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import type { Idea, VozGrupo } from '@/lib/insights/voz-cliente'

// Tarjetas de «qué dicen» (clientes potenciales y clientes). Se usan en el dashboard (resumen) y en
// la página de ideas de contenido (con citas). Cada porcentaje va con su n y su base; sin datos se
// dice «sin datos suficientes», nunca se pinta 0.

export type RespuestaVoz = {
  dias: number
  voz: { potenciales: VozGrupo; clientes: VozGrupo }
  ideas: Idea[]
  citasVisibles: boolean
  errores: string[]
}

export function useVozCliente(tenant: string, dias = 90) {
  const [datos, setDatos] = useState<RespuestaVoz | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    setCargando(true)
    setError(null)
    fetch(`/api/${tenant}/evergreen/insights/voz-cliente?dias=${dias}`, { signal: ac.signal })
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'No se pudo cargar')
        setDatos(j as RespuestaVoz)
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
      .finally(() => {
        if (!ac.signal.aborted) setCargando(false)
      })
    return () => ac.abort()
  }, [tenant, dias])
  return { datos, cargando, error }
}

const TITULOS = {
  potenciales: {
    titulo: 'Qué dicen tus clientes potenciales',
    sub: 'Formulario previo a la llamada y objeciones en la llamada de ventas',
  },
  clientes: {
    titulo: 'Qué dicen tus clientes',
    sub: 'Onboarding, feedback y lo que temían antes de comprar',
  },
} as const

const ORIGEN: Record<string, string> = {
  formulario_previo: 'formulario',
  llamada_ventas: 'llamada',
  feedback: 'feedback',
}

export function TarjetaVoz({ g, max = 5, citas = false }: { g: VozGrupo; max?: number; citas?: boolean }) {
  const t = TITULOS[g.grupo]
  return (
    <section className="dashboard-card p-5">
      <h3 className="text-sm font-semibold text-foreground">{t.titulo}</h3>
      <p className="text-xs text-muted-foreground">{t.sub}</p>
      {g.base < 5 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Sin datos suficientes{g.base > 0 ? ` (solo ${g.base} personas)` : ''}. Aparecerán cuando haya más respuestas.
        </p>
      ) : (
        <>
          <ul className="mt-3 space-y-2.5">
            {g.temas.slice(0, max).map((x) => (
              <li key={x.id} className="text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-foreground">{x.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {x.pct}% ({x.personas})
                  </span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div
                    className="h-full bg-brand-600 transition-[width] duration-300 ease-out motion-reduce:transition-none"
                    style={{ width: `${Math.min(100, x.pct)}%` }}
                  />
                </div>
                {citas && x.citas.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {x.citas.map((c, i) => (
                      <li key={i} className="text-xs italic text-muted-foreground">
                        «{c}»
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs tabular-nums text-muted-foreground">
            Base: {g.base} personas (
            {Object.entries(g.porOrigen)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${n} ${ORIGEN[k]}`)
              .join(', ')}
            ).
          </p>
          {g.otros.avisoClasificacion && (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {g.otros.pct}% ({g.otros.personas}) no encaja en ningún tema: la clasificación se queda corta.
            </p>
          )}
        </>
      )}
    </section>
  )
}

/** Bloque del dashboard: las dos tarjetas con su estado de carga y de error. */
export function VozClienteDashboard({ tenant }: { tenant: string }) {
  const { datos, cargando, error } = useVozCliente(tenant)
  if (cargando)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando voz del cliente…
      </div>
    )
  if (error)
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        No se pudo cargar la voz del cliente: {error}
      </p>
    )
  if (!datos) return null
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TarjetaVoz g={datos.voz.potenciales} />
      <TarjetaVoz g={datos.voz.clientes} />
    </div>
  )
}
