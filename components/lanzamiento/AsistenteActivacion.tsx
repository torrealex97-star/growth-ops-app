'use client'

import { Check, ChevronDown, Circle } from 'lucide-react'
import { useState } from 'react'
import type { PasoActivacion } from '@/lib/launch/conexion'
import { cn } from '@/lib/utils'

// Los cuatro pasos para que un lanzamiento reciba leads, con su estado real. Mientras falta alguno
// va desplegado y resalta UNO solo (el siguiente que toca) con su botón. Cuando están los cuatro,
// se pliega a una línea para no ocupar la pantalla de quien ya está operando.
export function AsistenteActivacion({
  pasos,
  completo,
  accionDe,
}: {
  pasos: PasoActivacion[]
  completo: boolean
  /** Botón del paso que toca ahora (o null si ese paso no tiene acción para esta persona). */
  accionDe: (paso: PasoActivacion) => React.ReactNode
}) {
  const [abierto, setAbierto] = useState(!completo)
  const hechos = pasos.filter((p) => p.estado === 'hecho').length

  return (
    <section aria-labelledby="titulo-activacion" className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span id="titulo-activacion" className="font-semibold text-foreground">
            {completo ? 'Lanzamiento activado' : 'Activa tu lanzamiento'}
          </span>
          <span className="ml-2 text-sm text-muted-foreground">
            {hechos} de {pasos.length} pasos
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', abierto && 'rotate-180')} />
      </button>

      {abierto && (
        <ol className="grid gap-px border-t border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {pasos.map((p, i) => (
            <li
              key={p.id}
              aria-current={p.estado === 'ahora' ? 'step' : undefined}
              className={cn('flex flex-col gap-2 bg-card p-4', p.estado === 'ahora' && 'bg-brand-500/5')}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    p.estado === 'hecho' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
                    p.estado === 'ahora' && 'bg-brand-600 text-white',
                    p.estado === 'pendiente' && 'bg-muted text-muted-foreground'
                  )}
                >
                  {p.estado === 'hecho' ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className="text-sm font-medium text-foreground">{p.titulo}</span>
              </div>
              <p className="text-xs text-muted-foreground">{p.detalle}</p>
              <p className="sr-only">
                {p.estado === 'hecho' ? 'Hecho' : p.estado === 'ahora' ? 'Es el paso que toca ahora' : 'Pendiente'}
              </p>
              {p.estado === 'ahora' ? (
                <div className="mt-auto pt-1">{accionDe(p)}</div>
              ) : (
                p.estado === 'pendiente' && (
                  <p className="mt-auto flex items-center gap-1 pt-1 text-xs text-muted-foreground">
                    <Circle className="h-3 w-3" /> Después del paso anterior
                  </p>
                )
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
