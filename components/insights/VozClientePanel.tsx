'use client'

import { useCallback, useEffect, useState } from 'react'
import { Copy, Lightbulb, Loader2, MessageSquareQuote, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ETIQUETA_ORIGEN, ORIGENES, type Origen, type Tema } from '@/lib/insights/voz-cliente'
import { useTenant } from '@/lib/tenant-context'

type Datos = {
  total: number
  clasificadas: number
  sinClasificar: number
  temas: Tema[]
  fuentes: { llamadas: number | null; formularios: number | null }
  errores: string[]
  ventanaDias: number
}

const FORMATO: Record<string, string> = { reel: 'Reel', carrusel: 'Carrusel', historia: 'Historia', flyer: 'Flyer' }

/**
 * Qué dicen los prospectos y los clientes (objeciones de llamadas, formularios de aplicación, feedback),
 * agrupado por temas con ideas de contenido. «compacto» = bloque del dashboard (3 temas, sin citas);
 * «completo» = sección de Contenido (todos los temas, citas anonimizadas e ideas). Estados: cargando,
 * error con reintentar, sin permiso (no se pinta), vacío con el siguiente paso, y parcial (una fuente falló).
 */
export function VozClientePanel({ modo = 'completo' }: { modo?: 'compacto' | 'completo' }) {
  const tenant = useTenant()
  const [datos, setDatos] = useState<Datos | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'ok' | 'error' | 'sin-permiso'>('cargando')

  const cargar = useCallback(
    async (señal?: AbortSignal) => {
      setEstado('cargando')
      try {
        const res = await fetch(`/api/${tenant}/evergreen/insights/voz-cliente`, { signal: señal })
        if (res.status === 401 || res.status === 403) return setEstado('sin-permiso')
        if (!res.ok) return setEstado('error')
        setDatos((await res.json()) as Datos)
        setEstado('ok')
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setEstado('error')
      }
    },
    [tenant]
  )

  useEffect(() => {
    const controlador = new AbortController()
    void cargar(controlador.signal)
    return () => controlador.abort()
  }, [cargar])

  if (estado === 'sin-permiso') return null
  const compacto = modo === 'compacto'
  const temas = datos ? (compacto ? datos.temas.slice(0, 3) : datos.temas) : []
  const copiar = (texto: string) => {
    void navigator.clipboard?.writeText(texto).then(
      () => toast.success('Gancho copiado'),
      () => toast.error('No se pudo copiar')
    )
  }

  return (
    <Card className="p-4 space-y-3" aria-labelledby={`voz-cliente-${modo}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`voz-cliente-${modo}`} className="font-semibold text-foreground flex items-center gap-2">
            <MessageSquareQuote className="h-4 w-4 text-brand-400" aria-hidden /> Qué dicen tus clientes
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Objeciones en llamadas, formularios de aplicación y feedback
            {datos ? ` · últimos ${datos.ventanaDias} días` : ''}. Cada tema necesita 2 o más menciones.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void cargar()}
          disabled={estado === 'cargando'}
          aria-label="Actualizar"
          title="Actualizar"
        >
          {estado === 'cargando' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>

      {estado === 'cargando' && !datos && (
        <p className="text-sm text-muted-foreground" role="status">
          Leyendo llamadas y formularios…
        </p>
      )}
      {estado === 'error' && (
        <p className="text-sm text-destructive" role="alert">
          No se pudo cargar. Reintenta con el botón de arriba.
        </p>
      )}
      {datos && datos.errores.length > 0 && (
        <p className="text-xs text-amber-400" role="status">
          Datos parciales: {datos.errores.join(' ')}
        </p>
      )}

      {estado === 'ok' && datos && (
        <>
          <p className="text-xs text-muted-foreground">
            {ORIGENES.map((o: Origen) => {
              const n = o === 'llamada' ? datos.fuentes.llamadas : o === 'formulario' ? datos.fuentes.formularios : null
              return `${ETIQUETA_ORIGEN[o]}: ${n === null && o !== 'feedback' ? '—' : (n ?? 'incluido en formularios')}`
            }).join(' · ')}
          </p>
          {temas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {datos.total === 0
                ? 'Todavía no hay señales: se alimenta de las llamadas analizadas con IA y de los formularios de aplicación o feedback completados.'
                : `Hay ${datos.total} mensajes pero ningún tema se repite aún (${datos.sinClasificar} sin clasificar). Se mostrará cuando un tema aparezca 2 veces.`}
            </p>
          ) : (
            <ul className="space-y-3">
              {temas.map((tema) => (
                <li key={tema.id} className="rounded-md border border-border p-3 space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-foreground">{tema.titulo}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {tema.menciones} {tema.menciones === 1 ? 'mención' : 'menciones'} · {tema.porcentaje}% de lo
                      clasificado
                    </span>
                  </div>
                  <div
                    className="h-1.5 w-full rounded bg-muted"
                    role="progressbar"
                    aria-valuenow={tema.porcentaje}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${tema.titulo}: ${tema.porcentaje}%`}
                  >
                    <div
                      className="h-full rounded bg-brand-500"
                      style={{ width: `${Math.max(tema.porcentaje, 2)}%` }}
                    />
                  </div>
                  {!compacto && (
                    <>
                      <p className="text-sm text-muted-foreground">{tema.dolor}</p>
                      {tema.citas.length > 0 && (
                        <ul className="space-y-1">
                          {tema.citas.map((cita) => (
                            <li key={cita} className="text-sm italic text-foreground/80 border-l-2 border-border pl-2">
                              «{cita}»
                            </li>
                          ))}
                        </ul>
                      )}
                      <div>
                        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                          <Lightbulb className="h-3 w-3" aria-hidden /> Ideas de contenido
                        </p>
                        <ul className="mt-1 space-y-1.5">
                          {tema.ideas.map((idea) => (
                            <li key={idea.gancho} className="flex items-start justify-between gap-2 text-sm">
                              <span>
                                <span className="text-xs rounded bg-muted px-1.5 py-0.5 mr-1.5 text-muted-foreground">
                                  {FORMATO[idea.formato]}
                                </span>
                                <strong className="font-medium">{idea.gancho}</strong>
                                <span className="block text-xs text-muted-foreground">{idea.angulo}</span>
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copiar(idea.gancho)}
                                aria-label={`Copiar gancho: ${idea.gancho}`}
                                title="Copiar gancho"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {compacto && datos.temas.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Las citas y las ideas de contenido están en Marketing → Contenido.
            </p>
          )}
        </>
      )}
    </Card>
  )
}
