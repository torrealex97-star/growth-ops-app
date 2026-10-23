'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CalendarPlus, Info, Loader2, RefreshCw, Rocket } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'

// PANEL DE LANZAMIENTOS. El calendario vive en la tabla `launches` (por subcuenta) y el lanzamiento
// ACTIVO decide a qué lanzamiento apuntan los leads nuevos del webhook. Abrir el siguiente mueve a
// los apuntados del anterior DESPUÉS de su evento y es un claim atómico: un doble clic no abre dos.
//
// Los cuatro estados se pintan distinto a propósito: "sin lanzamiento abierto" (hueco, no cero),
// "no se pudo leer" (error con Reintentar), "cargando" y datos. Nunca se muestran cifras parciales
// sin decir que la muestra está cortada (metricas.muestraCompleta = false).

type Lanzamiento = {
  id: string
  slug: string
  label: string
  fecha: string
  abierto: boolean
  abiertoAt: string | null
}

type Metricas = {
  leads: number
  muestraCompleta: boolean
  confirmados: number
  invitados: number
  conEncuesta: number
  avgQuality: number | null
  avgQualityJunio: number | null
  buenos: number
  tramoDineroMasComun: string | null
}

type Anuncio = {
  anuncio: string
  totalLeads: number
  conEncuesta: number
  avgQuality: number
  pctBuenos: number
  pctAmbicion: number
  pctIndependencia: number
  scoreComposite: number
  muestraCorta: boolean
  confirmados: number
}

type LeadReciente = {
  id: string
  nombre: string | null
  email: string | null
  phone: string | null
  fecha: string
  confirmado: boolean
  invitado: boolean
  anuncio: string | null
  campana: string | null
  quality: number | null
}

type PanelResponse = {
  calendario: Lanzamiento[]
  activo: Lanzamiento | null
  siguiente: Lanzamiento | null
  metricas?: Metricas | null
  dias?: { fecha: string; leads: number; confirmados: number }[]
  anuncios?: Anuncio[]
  leads?: LeadReciente[]
  edades?: number[]
  piden?: { tema: string; n: number; label: string }[]
}

const fechaCorta = (f: string) =>
  new Date(`${f}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
const fechaHora = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function LanzamientoPage() {
  const tenant = useTenant()
  const [data, setData] = useState<PanelResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nuevaFecha, setNuevaFecha] = useState('')
  const [accionando, setAccionando] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/lanzamiento`)
      const j = await r.json()
      if (!r.ok) {
        setError(j.error || 'No se pudo cargar el lanzamiento')
        setData(null)
        return
      }
      setData(j as PanelResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de conexión')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [tenant])

  useEffect(() => {
    void load()
  }, [load])

  const accion = async (body: Record<string, unknown>) => {
    setAccionando(true)
    setError(null)
    try {
      const r = await fetch(`/api/${tenant}/evergreen/lanzamiento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) {
        setError(j.error || 'No se pudo ejecutar la acción')
        return
      }
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de conexión')
    } finally {
      setAccionando(false)
    }
  }

  const { activo, siguiente } = data ?? {}
  const maxDia = Math.max(1, ...(data?.dias ?? []).map((d) => d.leads))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Lanzamientos</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Calendario y métricas del lanzamiento activo. Los leads nuevos del webhook de GHL se apuntan al activo.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm hover:bg-muted"
        >
          <RefreshCw className="h-4 w-4" /> Recargar
        </button>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando calendario…
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" /> No se pueden mostrar los datos: {error}
          </p>
          <button
            onClick={() => void load()}
            className="mt-2 inline-flex items-center gap-1.5 underline underline-offset-2"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Reintentar
          </button>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* ── Calendario ─────────────────────────────────────────────── */}
          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-semibold text-foreground">Calendario</h2>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={nuevaFecha}
                  onChange={(e) => setNuevaFecha(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
                <button
                  disabled={!nuevaFecha || accionando}
                  onClick={() => void accion({ accion: 'programar', fecha: nuevaFecha })}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                >
                  <CalendarPlus className="h-4 w-4" /> Programar
                </button>
                <button
                  disabled={accionando || !siguiente}
                  onClick={() => void accion({ accion: 'abrir', esperado: siguiente?.id })}
                  title={
                    siguiente ? `Abrir ${siguiente.label} (${siguiente.fecha})` : 'No quedan lanzamientos programados'
                  }
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  <Rocket className="h-4 w-4" /> Abrir siguiente
                </button>
              </div>
            </div>
            <ul className="mt-3 divide-y divide-border">
              {data.calendario.length === 0 && (
                <li className="py-3 text-sm text-muted-foreground">
                  Todavía no hay fechas en el calendario de esta subcuenta.
                </li>
              )}
              {data.calendario.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="font-medium text-foreground">
                    {l.label} <span className="text-muted-foreground">· {fechaCorta(l.fecha)}</span>
                    {activo?.id === l.id && (
                      <span className="ml-2 rounded-full bg-blue-600/10 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400">
                        activo
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {l.abierto ? `abierto ${l.abiertoAt ? fechaHora(l.abiertoAt) : ''}` : 'programado'}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* ── Sin lanzamiento abierto: hueco, no cero ────────────────── */}
          {!activo && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              No hay ningún lanzamiento abierto. Los webhooks de GHL no apuntan leads hasta que se abre uno.
            </p>
          )}

          {/* ── Métricas del activo ────────────────────────────────────── */}
          {activo && data.metricas && (
            <>
              <section>
                <h2 className="mb-2 font-semibold text-foreground">{activo.label} — métricas</h2>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    { label: 'Leads', valor: data.metricas.leads },
                    { label: 'Confirmados', valor: data.metricas.confirmados },
                    { label: 'Invitados', valor: data.metricas.invitados },
                    { label: 'Con encuesta', valor: data.metricas.conEncuesta },
                    {
                      label: 'Calidad media',
                      valor: data.metricas.avgQuality === null ? '—' : `${data.metricas.avgQuality}/10`,
                    },
                    {
                      label: 'Leads buenos',
                      valor:
                        data.metricas.conEncuesta > 0
                          ? `${Math.round((data.metricas.buenos / data.metricas.conEncuesta) * 100)}%`
                          : '—',
                    },
                  ].map((k) => (
                    <div key={k.label} className="rounded-lg border border-border bg-card p-3">
                      <p className="text-xs text-muted-foreground">{k.label}</p>
                      <p className="mt-1 text-xl font-semibold text-foreground">{k.valor}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Calidad media con el criterio v2 (independencia, ingresos, ambición, edad, relación con la IA).
                  {data.metricas.avgQualityJunio !== null &&
                    ` Criterio de junio para comparar: ${data.metricas.avgQualityJunio}/10.`}
                  {data.metricas.tramoDineroMasComun !== null &&
                    ` Ingreso más común entre los que contestaron: tramo ${data.metricas.tramoDineroMasComun}.`}
                  {!data.metricas.muestraCompleta &&
                    ' Ojo: el recuento de calidad se calcula sobre una muestra cortada; las cifras de detalle no cubren todos los leads.'}
                </p>
              </section>

              {/* ── Leads por día ────────────────────────────────────── */}
              {(data.dias?.length ?? 0) > 0 && (
                <section className="rounded-lg border border-border bg-card p-4">
                  <h3 className="font-semibold text-foreground">Apuntados por día (últimos 14 con datos)</h3>
                  <div className="mt-3 flex items-end gap-1.5">
                    {[...(data.dias ?? [])].reverse().map((d) => (
                      <div
                        key={d.fecha}
                        className="flex flex-1 flex-col items-center gap-1"
                        title={`${d.fecha}: ${d.leads} leads, ${d.confirmados} confirmados`}
                      >
                        <div className="flex w-full items-end justify-center gap-0.5" style={{ height: 64 }}>
                          <div
                            className="w-3 rounded-t bg-blue-600/70"
                            style={{ height: `${(d.leads / maxDia) * 100}%` }}
                          />
                          <div
                            className="w-3 rounded-t bg-emerald-500/70"
                            style={{ height: `${(d.confirmados / maxDia) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">{fechaCorta(d.fecha)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-sm bg-blue-600/70" /> apuntados
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-sm bg-emerald-500/70" /> confirmados
                    </span>
                  </p>
                </section>
              )}

              {/* ── Ranking de anuncios ──────────────────────────────── */}
              {(data.anuncios?.length ?? 0) > 0 && (
                <section className="rounded-lg border border-border bg-card p-4">
                  <h3 className="font-semibold text-foreground">Creativos que traen mejores leads</h3>
                  <p className="text-xs text-muted-foreground">
                    scoreComposite = leads × calidad media. El anuncio que trae muchos y buenos arriba.
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-muted-foreground">
                          <th className="py-1.5 pr-3 font-medium">Creativo</th>
                          <th className="py-1.5 pr-3 font-medium">Leads</th>
                          <th className="py-1.5 pr-3 font-medium">Calidad</th>
                          <th className="py-1.5 pr-3 font-medium">Buenos</th>
                          <th className="py-1.5 pr-3 font-medium">Con independencia</th>
                          <th className="py-1.5 pr-3 font-medium">Confirmados</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {data.anuncios?.map((a) => (
                          <tr key={a.anuncio}>
                            <td className="py-2 pr-3 font-medium text-foreground">
                              {a.anuncio}
                              {a.muestraCorta && (
                                <span className="ml-2 text-xs text-muted-foreground">muestra corta</span>
                              )}
                            </td>
                            <td className="py-2 pr-3">{a.totalLeads}</td>
                            <td className="py-2 pr-3">{a.conEncuesta > 0 ? `${a.avgQuality}/10` : '—'}</td>
                            <td className="py-2 pr-3">{a.conEncuesta > 0 ? `${a.pctBuenos}%` : '—'}</td>
                            <td className="py-2 pr-3">{a.conEncuesta > 0 ? `${a.pctIndependencia}%` : '—'}</td>
                            <td className="py-2 pr-3">{a.confirmados}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* ── Qué piden ────────────────────────────────────────── */}
              {(data.piden?.length ?? 0) > 0 && (
                <section className="rounded-lg border border-border bg-card p-4">
                  <h3 className="font-semibold text-foreground">Qué piden para que el evento merezca la pena</h3>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {data.piden?.map((p) => (
                      <li key={p.tema} className="rounded-full bg-muted px-3 py-1 text-sm text-foreground">
                        {p.label} <span className="text-muted-foreground">×{p.n}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* ── Últimos leads ────────────────────────────────────── */}
              <section className="rounded-lg border border-border bg-card p-4">
                <h3 className="font-semibold text-foreground">Últimos leads</h3>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="py-1.5 pr-3 font-medium">Nombre</th>
                        <th className="py-1.5 pr-3 font-medium">Fecha</th>
                        <th className="py-1.5 pr-3 font-medium">Calidad</th>
                        <th className="py-1.5 pr-3 font-medium">Anuncio</th>
                        <th className="py-1.5 pr-3 font-medium">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {(data.leads ?? []).map((l) => (
                        <tr key={l.id}>
                          <td className="py-2 pr-3">
                            <span className="font-medium text-foreground">{l.nombre ?? '—'}</span>
                            <span className="block text-xs text-muted-foreground">
                              {l.email ?? l.phone ?? 'sin contacto'}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-muted-foreground">{fechaHora(l.fecha)}</td>
                          <td className="py-2 pr-3">{l.quality === null ? 'sin encuesta' : `${l.quality}/10`}</td>
                          <td className="py-2 pr-3 text-muted-foreground">{l.anuncio ?? '—'}</td>
                          <td className="py-2 pr-3">
                            {l.confirmado ? (
                              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400">
                                confirmado
                              </span>
                            ) : l.invitado ? (
                              <span className="rounded-full bg-blue-600/10 px-2 py-0.5 text-xs text-blue-600 dark:text-blue-400">
                                invitado
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground">apuntado</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(data.leads?.length ?? 0) === 0 && (
                    <p className="py-3 text-sm text-muted-foreground">
                      Todavía no hay leads apuntados. Revisa que el webhook de GHL esté conectado en Integraciones.
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  )
}
