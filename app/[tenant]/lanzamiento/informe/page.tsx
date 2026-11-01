'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Info, Loader2 } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import type { PasoEmbudo, Veredicto, Accion, DatoFaltante, ItemDistribucion } from '@/lib/launch/informe'

// INFORME DEL LANZAMIENTO: DATA (qué pasó, medido) y ACCIONES (qué cambiar por culpa de eso).
// Reglas de la pantalla: cada porcentaje lleva su n; un dato que no se puede medir se dice «no
// disponible» (nunca un 0); las acciones citan la cifra que las justifica.

type Lanzamiento = { id: string; label: string; fecha: string }
type Informe = {
  lanzamiento: Lanzamiento
  muestraCompleta: boolean
  registrados: number
  conEncuesta: number
  embudo: PasoEmbudo[]
  anuncios: {
    anuncio: string
    totalLeads: number
    conEncuesta: number
    avgQuality: number
    pctBuenos: number
    citas: number
    muestraCorta: boolean
    veredicto: Veredicto
  }[]
  frenos: { base: number; items: ItemDistribucion[] }
  frases: { base: number; items: { frase: string; personas: number; pct: number }[] }
  faltan: DatoFaltante[]
  acciones: Accion[]
}

const ETIQUETA_VEREDICTO: Record<Veredicto, { texto: string; clase: string }> = {
  escalar: { texto: 'Escalar', clase: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' },
  mantener: { texto: 'Mantener', clase: 'bg-muted text-muted-foreground' },
  apagar: { texto: 'Apagar', clase: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  muestra_corta: { texto: 'Muestra corta', clase: 'bg-muted text-muted-foreground' },
}

const ETIQUETA_AREA: Record<Accion['area'], string> = {
  anuncios: 'Anuncios',
  embudo: 'Embudo',
  audiencia: 'Audiencia',
  datos: 'Datos',
}

const CAJA = 'rounded-lg border border-border bg-card p-4'

export default function InformeLanzamientoPage() {
  const tenant = useTenant()
  const [cal, setCal] = useState<Lanzamiento[]>([])
  const [launchId, setLaunchId] = useState('')
  const [informe, setInforme] = useState<Informe | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const ac = useRef<AbortController | null>(null)
  const base = `/api/${tenant}/evergreen/lanzamiento`

  const cargar = async (id: string) => {
    ac.current?.abort()
    const a = new AbortController()
    ac.current = a
    setCargando(true)
    setError(null)
    try {
      const r = await fetch(`${base}/informe?launch=${id}`, { signal: a.signal })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'No se pudo generar el informe')
      setInforme(j as Informe)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setInforme(null)
        setError(e instanceof Error ? e.message : 'Error de conexión')
      }
    } finally {
      if (ac.current === a) setCargando(false)
    }
  }

  useEffect(() => {
    const a = new AbortController()
    ;(async () => {
      try {
        const r = await fetch(base, { signal: a.signal })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'No se pudo leer el calendario')
        const lista = (j.calendario ?? []) as Lanzamiento[]
        setCal(lista)
        const inicial = (j.activo as Lanzamiento | null)?.id ?? lista[0]?.id ?? ''
        setLaunchId(inicial)
        if (inicial) await cargar(inicial)
        else setCargando(false)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError(e instanceof Error ? e.message : 'Error de conexión')
          setCargando(false)
        }
      }
    })()
    return () => {
      a.abort()
      ac.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base])

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${tenant}/lanzamiento`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Lanzamientos
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Informe del lanzamiento</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Qué pasó, medido, y qué cambiar por culpa de eso. Lo que no se puede medir se dice.
        </p>
      </div>

      {cal.length > 0 && (
        <select
          aria-label="Lanzamiento"
          value={launchId}
          onChange={(e) => {
            setLaunchId(e.target.value)
            void cargar(e.target.value)
          }}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        >
          {cal.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label} · {l.fecha}
            </option>
          ))}
        </select>
      )}

      {cargando && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Generando informe…
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {!cargando && !error && cal.length === 0 && (
        <p className={`${CAJA} text-sm text-muted-foreground`}>Aún no hay lanzamientos que analizar.</p>
      )}

      {informe && !cargando && (
        <>
          {!informe.muestraCompleta && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="h-4 w-4" /> Hay más de 5.000 registros: los porcentajes se calculan sobre los primeros
              5.000.
            </p>
          )}

          <section className={CAJA}>
            <h2 className="font-semibold text-foreground">Embudo</h2>
            <ol className="mt-3 space-y-2">
              {informe.embudo.map((p) => (
                <li key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
                  <div>
                    <p className="text-foreground">{p.etiqueta}</p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div
                        className="h-full bg-brand-600 transition-[width] duration-300 ease-out motion-reduce:transition-none"
                        style={{ width: `${p.pctSobreRegistrados ?? 0}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-right tabular-nums">
                    {p.n === null ? (
                      <span className="text-muted-foreground">Dato no disponible</span>
                    ) : (
                      <>
                        <span className="font-medium text-foreground">{p.n.toLocaleString('es-ES')}</span>
                        {p.pctSobreAnterior !== null && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {p.pctSobreAnterior}% del paso anterior
                          </span>
                        )}
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section className={CAJA}>
            <h2 className="font-semibold text-foreground">Anuncios</h2>
            {informe.anuncios.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Ningún anuncio llega al mínimo de leads para compararse (o los leads no guardan el anuncio de origen).
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">Anuncio</th>
                      <th className="py-1 pr-3 text-right font-medium">Leads</th>
                      <th className="py-1 pr-3 text-right font-medium">Buenos (n encuesta)</th>
                      <th className="py-1 pr-3 text-right font-medium">Con cita</th>
                      <th className="py-1 font-medium">Veredicto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border tabular-nums">
                    {informe.anuncios.map((a) => (
                      <tr key={a.anuncio}>
                        <td className="max-w-[16rem] truncate py-2 pr-3 text-foreground">{a.anuncio}</td>
                        <td className="py-2 pr-3 text-right">{a.totalLeads}</td>
                        <td className="py-2 pr-3 text-right">
                          {a.conEncuesta > 0 ? `${a.pctBuenos}% (${a.conEncuesta})` : '—'}
                        </td>
                        <td className="py-2 pr-3 text-right">{a.citas}</td>
                        <td className="py-2">
                          <span className={`rounded px-2 py-0.5 text-xs ${ETIQUETA_VEREDICTO[a.veredicto].clase}`}>
                            {ETIQUETA_VEREDICTO[a.veredicto].texto}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <section className={CAJA}>
              <h2 className="font-semibold text-foreground">Qué les frena</h2>
              {informe.frenos.base === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Dato no disponible: nadie ha contestado esa pregunta.
                </p>
              ) : (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {informe.frenos.items.map((f) => (
                    <li key={f.texto} className="flex justify-between gap-3">
                      <span className="text-foreground">{f.texto}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {f.pct}% ({f.n})
                      </span>
                    </li>
                  ))}
                  <li className="pt-1 text-xs text-muted-foreground">Sobre {informe.frenos.base} respuestas.</li>
                </ul>
              )}
            </section>
            <section className={CAJA}>
              <h2 className="font-semibold text-foreground">Sus frases</h2>
              {informe.frases.items.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Sin frases repetidas por al menos 3 personas
                  {informe.frases.base > 0
                    ? ` (sobre ${informe.frases.base} respuestas).`
                    : ': nadie ha escrito texto libre.'}
                </p>
              ) : (
                <ul className="mt-3 space-y-1.5 text-sm">
                  {informe.frases.items.map((f) => (
                    <li key={f.frase} className="flex justify-between gap-3">
                      <span className="text-foreground">«{f.frase}»</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {f.personas} personas ({f.pct}%)
                      </span>
                    </li>
                  ))}
                  <li className="pt-1 text-xs text-muted-foreground">Sobre {informe.frases.base} respuestas.</li>
                </ul>
              )}
            </section>
          </div>

          <section className={CAJA}>
            <h2 className="font-semibold text-foreground">Acciones</h2>
            {informe.acciones.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Con los datos actuales no hay ningún cambio que se justifique con una cifra.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {informe.acciones.map((a, i) => (
                  <li key={i} className="py-2.5 text-sm">
                    <span className="mr-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                      {ETIQUETA_AREA[a.area]}
                    </span>
                    <span className="text-foreground">{a.texto}</span>
                    <p className="mt-0.5 text-xs text-muted-foreground">{a.dato}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {informe.faltan.length > 0 && (
            <section className={CAJA}>
              <h2 className="font-semibold text-foreground">Datos que faltan ({informe.faltan.length})</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {informe.faltan.map((f) => (
                  <li key={f.id}>
                    <p className="text-foreground">{f.mensaje}</p>
                    <p className="text-xs text-muted-foreground">{f.solucion}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
