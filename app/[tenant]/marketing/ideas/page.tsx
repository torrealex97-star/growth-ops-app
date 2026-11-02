'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowLeft, Lightbulb, Loader2 } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { TarjetaVoz, useVozCliente } from '@/components/insights/VozCliente'

// IDEAS DE CONTENIDO a partir de lo que dicen potenciales y clientes (formularios, objeciones de
// llamada, feedback). Cada idea cita la cifra que la justifica. Las citas literales anonimizadas
// solo las ven admin y director.

const FORMATO: Record<string, string> = { carrusel: 'Carrusel', reel: 'Reel', email: 'Email', historia: 'Historia' }
const PERIODOS = [30, 90, 180]

export default function IdeasContenidoPage() {
  const tenant = useTenant()
  const [dias, setDias] = useState(90)
  const { datos, cargando, error } = useVozCliente(tenant, dias)

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${tenant}/marketing/contenido`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Contenido
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-foreground">
          <Lightbulb className="h-6 w-6 text-brand-400" /> Ideas de contenido
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Salen de lo que dicen tus clientes potenciales y tus clientes, no de lo que suponemos.
        </p>
      </div>

      <div className="flex gap-1" role="group" aria-label="Periodo">
        {PERIODOS.map((d) => (
          <button
            key={d}
            onClick={() => setDias(d)}
            aria-pressed={dias === d}
            className={`rounded-md border px-3 py-1.5 text-sm tabular-nums ${
              dias === d ? 'border-brand-600 bg-brand-600 text-white' : 'border-border bg-card hover:bg-muted'
            }`}
          >
            {d} días
          </button>
        ))}
      </div>

      {cargando && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Analizando…
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {datos && !cargando && (
        <>
          {datos.errores.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Algunas fuentes no se pudieron leer ({datos.errores.join(', ')}): las cifras pueden estar incompletas.
            </p>
          )}

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold text-foreground">Ideas ({datos.ideas.length})</h2>
            {datos.ideas.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Aún no hay un tema repetido por al menos 3 personas. Cuando haya más respuestas aparecerán aquí.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {datos.ideas.map((i, n) => (
                  <li key={n} className="py-3 text-sm">
                    <p className="text-foreground">
                      <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {FORMATO[i.formato]}
                      </span>
                      <span className="font-medium">{i.titulo}</span>
                    </p>
                    <p className="mt-0.5 text-muted-foreground">{i.gancho}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                      {i.tema} · {i.dato}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <TarjetaVoz g={datos.voz.potenciales} max={8} citas={datos.citasVisibles} />
            <TarjetaVoz g={datos.voz.clientes} max={8} citas={datos.citasVisibles} />
          </div>
        </>
      )}
    </div>
  )
}
