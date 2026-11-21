'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, CalendarPlus, Info, Plug, RefreshCw, Rocket } from 'lucide-react'
import { toast } from 'sonner'
import { AsistenteActivacion } from '@/components/lanzamiento/AsistenteActivacion'
import { CalendarioLanzamientos, type AccionCalendario } from '@/components/lanzamiento/CalendarioLanzamientos'
import { ConexionGhl } from '@/components/lanzamiento/ConexionGhl'
import { GraficaApuntados } from '@/components/lanzamiento/GraficaApuntados'
import { NavLanzamiento } from '@/components/lanzamiento/NavLanzamiento'
import { TablaLeads } from '@/components/lanzamiento/TablaLeads'
import { diaEvento, type ConexionResponse, type PanelResponse } from '@/components/lanzamiento/tipos'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { activacionCompleta, pasosActivacion, type PasoActivacion } from '@/lib/launch/conexion'
import { useTenant } from '@/lib/tenant-context'
import { formatDateTime, formatNumber, formatPercent } from '@/lib/utils'

// PANEL DE LANZAMIENTOS.
//
// El calendario vive en `launches` (por subcuenta) y el lanzamiento ABIERTO decide a qué lanzamiento
// se apuntan los leads nuevos del webhook de GHL. Esta pantalla hace tres cosas, en este orden:
//   1. Guía la activación (programar → abrir → conectar GHL → probar) con el estado real de cada paso.
//   2. Enseña los datos del lanzamiento que se está viendo: el abierto o uno pasado (`?launch=`).
//   3. Da las direcciones del webhook para GHL sin salir de aquí (pestaña Conexión).
//
// ESTADOS, pintados distinto a propósito: cargando (esqueleto), no se pudo leer (error con
// Reintentar), sin lanzamiento (hueco, no cero) y datos. Un error de una ACCIÓN no es un error de
// carga: sale como aviso y deja el panel donde estaba — antes compartían estado y un 403 al pulsar
// un botón borraba el calendario y las métricas.

const PESTANAS = ['resumen', 'anuncios', 'leads', 'conexion'] as const
type Pestana = (typeof PESTANAS)[number]

export default function LanzamientoPage() {
  return (
    <Suspense fallback={<Esqueleto />}>
      <Panel />
    </Suspense>
  )
}

function Esqueleto() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando lanzamientos">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  )
}

function Panel() {
  const tenant = useTenant()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const launchParam = sp.get('launch')
  const tabParam = sp.get('tab') as Pestana | null
  const pestana: Pestana = tabParam && PESTANAS.includes(tabParam) ? tabParam : 'resumen'

  const [data, setData] = useState<PanelResponse | null>(null)
  const [cargando, setCargando] = useState(true)
  const [errorCarga, setErrorCarga] = useState<string | null>(null)
  const [ejecutando, setEjecutando] = useState(false)
  const [dialogo, setDialogo] = useState<'programar' | 'abrir' | null>(null)
  const [conexion, setConexion] = useState<ConexionResponse | null>(null)
  const [cargandoConexion, setCargandoConexion] = useState(true)
  const [errorConexion, setErrorConexion] = useState<string | null>(null)
  const abortPanel = useRef<AbortController | null>(null)
  const abortConexion = useRef<AbortController | null>(null)
  const base = `/api/${tenant}/evergreen/lanzamiento`

  const irA = useCallback(
    (cambios: Record<string, string | null>) => {
      const next = new URLSearchParams(sp.toString())
      for (const [k, v] of Object.entries(cambios)) {
        if (v === null) next.delete(k)
        else next.set(k, v)
      }
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    },
    [router, pathname, sp]
  )

  const cargar = useCallback(async () => {
    abortPanel.current?.abort()
    const ac = new AbortController()
    abortPanel.current = ac
    setCargando(true)
    setErrorCarga(null)
    try {
      const r = await fetch(launchParam ? `${base}?launch=${encodeURIComponent(launchParam)}` : base, {
        signal: ac.signal,
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'No se pudo cargar el lanzamiento')
      setData(j as PanelResponse)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      // Se conserva lo último que se leyó bien: un fallo al recargar no vacía la pantalla.
      setErrorCarga(e instanceof Error ? e.message : 'Error de conexión')
    } finally {
      if (abortPanel.current === ac) setCargando(false)
    }
  }, [base, launchParam])

  const cargarConexion = useCallback(async () => {
    abortConexion.current?.abort()
    const ac = new AbortController()
    abortConexion.current = ac
    setCargandoConexion(true)
    setErrorConexion(null)
    try {
      const r = await fetch(`${base}/conexion`, { signal: ac.signal })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'No se pudo leer la conexión')
      setConexion(j as ConexionResponse)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setErrorConexion(e instanceof Error ? e.message : 'Error de conexión')
    } finally {
      if (abortConexion.current === ac) setCargandoConexion(false)
    }
  }, [base])

  useEffect(() => {
    void cargar()
    return () => abortPanel.current?.abort()
  }, [cargar])

  useEffect(() => {
    void cargarConexion()
    return () => abortConexion.current?.abort()
  }, [cargarConexion])

  const recargar = () => {
    void cargar()
    void cargarConexion()
  }

  const accion = async (a: AccionCalendario): Promise<boolean> => {
    setEjecutando(true)
    try {
      const r = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(a),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(j.error || 'No se pudo ejecutar la acción')
        return false
      }
      if (a.accion === 'abrir') {
        const movidos = Number(j.movidos ?? 0)
        toast.success(
          `${j.nuevo?.label ?? 'Lanzamiento'} abierto.` +
            (movidos > 0 ? ` ${formatNumber(movidos)} apuntados movidos desde el anterior.` : '')
        )
        // Tras abrir se enseña el nuevo activo, no el que se estuviera consultando.
        if (launchParam) irA({ launch: null })
      } else if (a.accion === 'programar')
        toast.success('Fecha programada. Ábrelo cuando quieras empezar a recibir leads.')
      else if (a.accion === 'cerrar') toast.success('Lanzamiento cerrado')
      else if (a.accion === 'borrar') toast.success('Fecha borrada del calendario')
      else toast.success('Guardado')
      await cargar()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de conexión')
      return false
    } finally {
      setEjecutando(false)
    }
  }

  const pasos = useMemo(
    () =>
      data
        ? pasosActivacion({
            calendario: data.calendario,
            activo: data.activo,
            secretoConfigurado: conexion ? conexion.secretoConfigurado : null,
            ultimoEvento: conexion?.ultimoEvento ?? null,
            leads: data.activo && data.visto?.id === data.activo.id ? (data.metricas?.leads ?? 0) : 0,
          })
        : [],
    [data, conexion]
  )
  // Mientras la conexión aún no ha respondido no se sabe si falta el paso 3: no se enseña el
  // asistente a medias (parpadearía de "falta" a "hecho").
  const asistenteListo = Boolean(data) && (Boolean(conexion) || Boolean(errorConexion))
  const completo = asistenteListo && Boolean(conexion) && activacionCompleta(pasos)

  const accionDePaso = (p: PasoActivacion) => {
    if (p.id === 'programar' || p.id === 'abrir') {
      if (!data?.puedeEditar) return <p className="text-xs text-muted-foreground">{data?.motivoSoloLectura}</p>
      return (
        <Button size="sm" onClick={() => setDialogo(p.id as 'programar' | 'abrir')}>
          {p.id === 'programar' ? <CalendarPlus className="mr-1.5 h-4 w-4" /> : <Rocket className="mr-1.5 h-4 w-4" />}
          {p.id === 'programar' ? 'Programar fecha' : 'Abrir lanzamiento'}
        </Button>
      )
    }
    return (
      <Button
        size="sm"
        variant={p.id === 'conectar' ? 'default' : 'outline'}
        onClick={() => {
          // Sin lanzamiento abierto no hay pestañas: la conexión está más abajo en la misma página.
          if (data?.visto) irA({ tab: 'conexion' })
          else document.getElementById('titulo-conexion-previa')?.scrollIntoView({ behavior: 'smooth' })
        }}
      >
        <Plug className="mr-1.5 h-4 w-4" />
        {p.id === 'conectar' ? 'Ver direcciones y secreto' : 'Cómo probar'}
      </Button>
    )
  }

  const { activo, visto, metricas } = data ?? {}
  const viendoPasado = Boolean(visto && activo && visto.id !== activo.id) || Boolean(visto && !activo)
  const pct = (parte: number | null | undefined, total: number | null | undefined) =>
    parte == null || !total ? '—' : formatPercent((parte / total) * 100, 0)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Lanzamientos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Programa el evento, ábrelo y conecta GHL: los leads que se registren se apuntan al lanzamiento abierto.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={recargar} disabled={cargando}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${cargando ? 'animate-spin' : ''}`} /> Recargar
        </Button>
      </div>

      <NavLanzamiento tenant={tenant} />

      {errorCarga && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-300"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {data ? 'No se pudo actualizar; ves los últimos datos leídos' : 'No se pueden mostrar los datos'}:{' '}
            {errorCarga}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void cargar()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reintentar
          </Button>
        </div>
      )}

      {!data && cargando && <Esqueleto />}

      {data && (
        <>
          {asistenteListo && (
            <AsistenteActivacion key={String(completo)} pasos={pasos} completo={completo} accionDe={accionDePaso} />
          )}

          <CalendarioLanzamientos
            calendario={data.calendario}
            activo={data.activo}
            siguiente={data.siguiente}
            visto={data.visto}
            puedeEditar={data.puedeEditar}
            motivoSoloLectura={data.motivoSoloLectura}
            ejecutando={ejecutando}
            onAccion={accion}
            onVer={(id) => irA({ launch: id === data.activo?.id ? null : id })}
            abrirDialogo={dialogo}
            onDialogo={setDialogo}
          />

          {data.activoPasado && activo && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                El evento de {activo.label} fue el {diaEvento(activo.fecha)}, pero sigue abierto: los leads nuevos se
                siguen apuntando a él. Abre el siguiente o ciérralo.
              </span>
            </p>
          )}

          {!visto ? (
            <p className="flex items-start gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              Aún no se ha abierto ningún lanzamiento, así que no hay datos que enseñar. Sigue los pasos de arriba.
            </p>
          ) : (
            <section aria-labelledby="titulo-visto" className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="titulo-visto" className="text-lg font-semibold text-foreground">
                  {visto.label}
                </h2>
                <span className="text-sm text-muted-foreground">Evento del {diaEvento(visto.fecha)}</span>
                {viendoPasado ? (
                  <>
                    <Badge variant="outline">Histórico</Badge>
                    {activo && (
                      <Button variant="link" size="sm" className="h-auto p-0" onClick={() => irA({ launch: null })}>
                        Volver al abierto
                      </Button>
                    )}
                  </>
                ) : (
                  <Badge variant="success">Abierto · recibe leads</Badge>
                )}
              </div>

              <Tabs value={pestana} onValueChange={(v) => irA({ tab: v === 'resumen' ? null : v })}>
                {/* En móvil las cuatro pestañas no caben: se desplazan dentro de su caja, no la página. */}
                <TabsList className="h-auto max-w-full justify-start overflow-x-auto">
                  <TabsTrigger value="resumen">Resumen</TabsTrigger>
                  <TabsTrigger value="anuncios">Anuncios</TabsTrigger>
                  <TabsTrigger value="leads">Leads</TabsTrigger>
                  <TabsTrigger value="conexion">Conexión con GHL</TabsTrigger>
                </TabsList>

                {/* ── Resumen ──────────────────────────────────────────── */}
                <TabsContent value="resumen" className="space-y-4">
                  {metricas && (
                    <>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        {[
                          { label: 'Apuntados', valor: formatNumber(metricas.leads), nota: 'Registrados al evento' },
                          {
                            label: 'Confirmaron',
                            valor: formatNumber(metricas.confirmados),
                            nota: `${pct(metricas.confirmados, metricas.leads)} de los apuntados`,
                          },
                          {
                            label: 'Con encuesta',
                            valor: formatNumber(metricas.conEncuesta),
                            nota: `${pct(metricas.conEncuesta, metricas.filasLeidas)} contestó`,
                          },
                          {
                            label: 'Calidad media',
                            valor:
                              metricas.avgQuality === null
                                ? '—'
                                : `${formatNumber(metricas.avgQuality, { maximumFractionDigits: 1 })}/10`,
                            nota:
                              metricas.avgQuality === null
                                ? 'Nadie ha contestado la encuesta'
                                : `${pct(metricas.buenos, metricas.conEncuesta)} con 8 o más`,
                          },
                          {
                            label: 'Agendaron',
                            valor: metricas.agendaron === null ? '—' : formatNumber(metricas.agendaron),
                            nota:
                              metricas.agendaron === null
                                ? 'No se pudo cruzar con las agendas'
                                : 'Con una llamada no cancelada',
                          },
                          {
                            label: 'Compraron',
                            valor: metricas.compraron === null ? '—' : formatNumber(metricas.compraron),
                            nota:
                              metricas.compraron === null
                                ? 'No se pudo cruzar con las ventas'
                                : 'Venta activa; una reserva sin completar no cuenta',
                          },
                        ].map((k) => (
                          <div key={k.label} className="rounded-lg border border-border bg-card p-3">
                            <p className="text-xs text-muted-foreground">{k.label}</p>
                            <p className="mt-1 text-xl font-semibold text-foreground">{k.valor}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">{k.nota}</p>
                          </div>
                        ))}
                      </div>

                      {!metricas.muestraCompleta && (
                        <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            Apuntados y confirmados son el total real. La calidad, los días y los anuncios se calculan
                            sobre los {formatNumber(metricas.filasLeidas)} leads más recientes de{' '}
                            {formatNumber(metricas.leads)}, y por eso no se cruzan agendas ni ventas.
                          </span>
                        </p>
                      )}

                      {metricas.leads === 0 ? (
                        <div className="rounded-lg border border-dashed border-border p-6 text-center">
                          <p className="font-medium text-foreground">Todavía no ha entrado ningún lead</p>
                          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                            Los leads entran solos cuando GHL llama al webhook. Si ya lo has configurado, haz un
                            registro de prueba.
                          </p>
                          <Button size="sm" className="mt-3" onClick={() => irA({ tab: 'conexion' })}>
                            <Plug className="mr-1.5 h-4 w-4" /> Ver conexión con GHL
                          </Button>
                        </div>
                      ) : (
                        <>
                          {(data.dias?.length ?? 0) > 0 && <GraficaApuntados dias={data.dias ?? []} />}

                          {(data.piden?.length ?? 0) > 0 && (
                            <section className="rounded-lg border border-border bg-card p-4">
                              <h3 className="font-semibold text-foreground">Qué esperan del evento</h3>
                              <p className="text-xs text-muted-foreground">
                                Temas de la pregunta abierta de la encuesta, agrupados por palabras clave.
                              </p>
                              <ul className="mt-3 flex flex-wrap gap-2">
                                {data.piden?.map((p) => (
                                  <li key={p.tema} className="rounded-full bg-muted px-3 py-1 text-sm text-foreground">
                                    {p.label} <span className="text-muted-foreground">×{formatNumber(p.n)}</span>
                                  </li>
                                ))}
                              </ul>
                            </section>
                          )}

                          <section className="rounded-lg border border-border bg-card p-4">
                            <div className="flex items-center justify-between gap-2">
                              <h3 className="font-semibold text-foreground">Últimos en apuntarse</h3>
                              <Button
                                variant="link"
                                size="sm"
                                className="h-auto p-0"
                                onClick={() => irA({ tab: 'leads' })}
                              >
                                Ver todos
                              </Button>
                            </div>
                            <ul className="mt-2 divide-y divide-border">
                              {(data.recientes ?? []).map((l) => (
                                <li
                                  key={l.id}
                                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                                >
                                  <span>
                                    <span className="font-medium text-foreground">{l.nombre || 'Sin nombre'}</span>
                                    <span className="block text-xs text-muted-foreground">
                                      {formatDateTime(l.fecha)}
                                      {l.anuncio ? ` · ${l.anuncio}` : ''}
                                    </span>
                                  </span>
                                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                    {l.quality === null
                                      ? 'Sin encuesta'
                                      : `${formatNumber(l.quality, { maximumFractionDigits: 1 })}/10`}
                                    {l.confirmado && <Badge variant="success">Confirmó</Badge>}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </section>
                        </>
                      )}
                    </>
                  )}
                </TabsContent>

                {/* ── Anuncios ─────────────────────────────────────────── */}
                <TabsContent value="anuncios">
                  {(data.anuncios?.length ?? 0) === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-6 text-center">
                      <p className="font-medium text-foreground">Aún no se puede comparar anuncios</p>
                      <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
                        Hacen falta al menos 3 leads de un mismo anuncio, y que GHL mande el parámetro{' '}
                        <code className="rounded bg-muted px-1 text-foreground">utm_content</code> con el nombre del
                        anuncio en el alta.
                      </p>
                    </div>
                  ) : (
                    <section className="rounded-lg border border-border bg-card p-4">
                      <h3 className="font-semibold text-foreground">Qué anuncios traen mejores leads</h3>
                      <p className="text-xs text-muted-foreground">
                        Ordenados por leads × calidad media: arriba el que trae muchos y buenos. Las variantes de un
                        mismo creativo se suman.
                      </p>
                      <div className="mt-3 overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-muted-foreground">
                              <th scope="col" className="py-1.5 pr-3 font-medium">
                                Anuncio
                              </th>
                              <th scope="col" className="py-1.5 pr-3 font-medium">
                                Leads
                              </th>
                              <th scope="col" className="py-1.5 pr-3 font-medium">
                                Calidad
                              </th>
                              <th scope="col" className="py-1.5 pr-3 font-medium">
                                Con 8 o más
                              </th>
                              <th scope="col" className="py-1.5 pr-3 font-medium">
                                Confirmaron
                              </th>
                              <th scope="col" className="py-1.5 pr-3 font-medium">
                                Agendaron
                              </th>
                              <th scope="col" className="py-1.5 pr-3 font-medium">
                                Compraron
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {data.anuncios?.map((a) => (
                              <tr key={a.anuncio} className="align-top">
                                <td className="py-2 pr-3">
                                  <span className="font-medium text-foreground">{a.anuncio}</span>
                                  <span className="block text-xs text-muted-foreground">
                                    {a.variantes > 1 ? `${a.variantes} variantes · ` : ''}
                                    {a.muestraCorta ? 'Pocas encuestas: nota orientativa' : (a.porQue[0] ?? '')}
                                  </span>
                                </td>
                                <td className="py-2 pr-3">{formatNumber(a.totalLeads)}</td>
                                <td className="py-2 pr-3">
                                  {a.conEncuesta > 0
                                    ? `${formatNumber(a.avgQuality, { maximumFractionDigits: 1 })}/10`
                                    : '—'}
                                </td>
                                <td className="py-2 pr-3">{a.conEncuesta > 0 ? formatPercent(a.pctBuenos, 0) : '—'}</td>
                                <td className="py-2 pr-3">{formatNumber(a.confirmados)}</td>
                                <td className="py-2 pr-3">{a.citas === null ? '—' : formatNumber(a.citas)}</td>
                                <td className="py-2 pr-3">{a.ventas === null ? '—' : formatNumber(a.ventas)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Para el gasto y el coste por lead de cada anuncio, mira el{' '}
                        <Link href={`/${tenant}/lanzamiento/informe`} className="underline underline-offset-2">
                          Informe
                        </Link>
                        .
                      </p>
                    </section>
                  )}
                </TabsContent>

                {/* ── Leads ────────────────────────────────────────────── */}
                <TabsContent value="leads">
                  {pestana === 'leads' && (
                    <TablaLeads
                      key={visto.id}
                      tenant={tenant}
                      launchId={visto.id}
                      anuncios={data.anunciosVistos ?? []}
                      puedeExportar={data.puedeEditar}
                    />
                  )}
                </TabsContent>

                {/* ── Conexión ─────────────────────────────────────────── */}
                <TabsContent value="conexion">
                  <ConexionGhl
                    tenant={tenant}
                    conexion={conexion}
                    cargando={cargandoConexion}
                    error={errorConexion}
                    onReintentar={() => void cargarConexion()}
                  />
                </TabsContent>
              </Tabs>
            </section>
          )}

          {/* Sin lanzamiento abierto no hay pestañas, pero las direcciones hacen falta igual para
              dejar GHL preparado antes de abrir. */}
          {!visto && (
            <section aria-labelledby="titulo-conexion-previa" className="space-y-3">
              <h2 id="titulo-conexion-previa" className="text-lg font-semibold text-foreground">
                Conexión con GHL
              </h2>
              <ConexionGhl
                tenant={tenant}
                conexion={conexion}
                cargando={cargandoConexion}
                error={errorConexion}
                onReintentar={() => void cargarConexion()}
              />
            </section>
          )}
        </>
      )}
    </div>
  )
}
