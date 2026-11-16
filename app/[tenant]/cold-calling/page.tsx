'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import {
  CLASE_TONO,
  textoTramos,
  type Estado,
  type Lead,
  type ManagerResponse,
  type StatsCaller,
} from '@/components/cold-calling/tipos'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTenant } from '@/lib/tenant-context'
import { cn, formatCurrency, formatDateTime, formatNumber } from '@/lib/utils'

// PANEL DEL EQUIPO DE COLD CALLING.
//
// Lo que necesita quien reparte y supervisa: cómo va cada cold caller, qué leads se están quedando
// fríos, qué ha pasado últimamente y cuánto dinero hay en juego. Solo lectura salvo tres acciones:
// repartir una tanda, reasignar un lead con motivo y recalcular comisiones.
//
// Se refresca al volver a la pestaña y con el botón, nunca con un temporizador: el panel no cambia
// solo y un sondeo continuo no cabe en el plan gratuito de la base de datos.

export default function ColdCallingPanelPage() {
  return (
    <Suspense fallback={<Esqueleto />}>
      <Panel />
    </Suspense>
  )
}

function Esqueleto() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando el panel de cold calling">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

const Kpi = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="dashboard-card p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
    {hint && <p className="mt-0.5 text-2xs text-muted-foreground">{hint}</p>}
  </div>
)

function Panel() {
  const tenant = useTenant()
  const router = useRouter()
  const sp = useSearchParams()
  const launchParam = sp.get('launch')
  const base = `/api/${tenant}/evergreen/cold-calling/manager`

  const [data, setData] = useState<ManagerResponse | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accion, setAccion] = useState<string | null>(null)
  const [reasignar, setReasignar] = useState<{ lead: Lead; caller: string } | null>(null)
  const abort = useRef<AbortController | null>(null)

  const cargar = useCallback(
    async (silencioso = false) => {
      abort.current?.abort()
      const ac = new AbortController()
      abort.current = ac
      if (!silencioso) setCargando(true)
      setError(null)
      try {
        const p = new URLSearchParams()
        if (launchParam) p.set('launch', launchParam)
        const r = await fetch(p.size ? `${base}?${p}` : base, { signal: ac.signal })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'No se pudo cargar el panel')
        setData(j as ManagerResponse)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Error de conexión')
      } finally {
        if (abort.current === ac) setCargando(false)
      }
    },
    [base, launchParam]
  )

  useEffect(() => {
    void cargar()
    return () => abort.current?.abort()
  }, [cargar])

  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible' && !reasignar) void cargar(true)
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [cargar, reasignar])

  const estadoPorId = new Map<string, Estado>((data?.estados ?? []).map((e) => [e.id, e]))

  const mandar = async (cuerpo: Record<string, unknown>, clave: string) => {
    setAccion(clave)
    try {
      const r = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(j.error || 'No se pudo completar la acción')
        return null
      }
      return j as Record<string, unknown>
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de conexión')
      return null
    } finally {
      setAccion(null)
    }
  }

  const repartir = async (caller: StatsCaller) => {
    const j = await mandar({ accion: 'repartir', callerId: caller.callerId }, `repartir:${caller.callerId}`)
    if (!j) return
    const n = typeof j.asignados === 'number' ? j.asignados : 0
    if (n > 0) toast.success(`${formatNumber(n)} leads para ${caller.nombre}`)
    else toast.info('No quedan leads por repartir en este lanzamiento')
    await cargar(true)
  }

  const sincronizar = async () => {
    const j = await mandar({ accion: 'sincronizar' }, 'sincronizar')
    if (!j) return
    toast.success('Comisiones recalculadas')
    await cargar(true)
  }

  if (error) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-red-500">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void cargar()}>
          Reintentar
        </Button>
      </div>
    )
  }

  if (cargando && !data) return <Esqueleto />

  if (!data) return null

  const { lanzamientos, launch, ajustes, stats, totales, atencion, actividad, ventas, dinero, hayTramos } = data
  const estadoDe = (id: string | null) => (id ? estadoPorId.get(id) : undefined)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Panel de cold calling</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Actividad del equipo, leads que se enfrían y comisiones del lanzamiento.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lanzamientos.length > 1 && (
            <select
              value={launch?.id ?? ''}
              onChange={(e) => router.replace(`/${tenant}/cold-calling?launch=${e.target.value}`)}
              aria-label="Lanzamiento"
              className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground"
            >
              {lanzamientos.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label} · {l.fecha}
                  {l.abierto ? '' : ` (${l.estado})`}
                </option>
              ))}
            </select>
          )}
          <Button variant="outline" size="sm" onClick={() => void cargar(true)} disabled={cargando}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Actualizar
          </Button>
        </div>
      </div>

      {!launch ? (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          No hay ningún lanzamiento abierto. Cuando abras uno en{' '}
          <Link href={`/${tenant}/lanzamiento`} className="text-brand-400 hover:underline">
            Lanzamientos
          </Link>
          , desde aquí podrás repartir sus leads.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Leads repartidos" value={formatNumber(totales?.asignados ?? 0)} hint={launch.label} />
            <Kpi label="Por llamar" value={formatNumber(totales?.porLlamar ?? 0)} hint="sin tocar todavía" />
            <Kpi label="Confirmados" value={formatNumber(totales?.confirmados ?? 0)} />
            <Kpi label="Ventas" value={formatNumber(totales?.ventas ?? 0)} hint="desde el primer lead" />
          </div>

          {totales?.truncado && (
            <p className="text-xs text-amber-500">
              El lanzamiento tiene más leads de los que se leen de una vez: los totales son un mínimo.
            </p>
          )}

          <section className="dashboard-card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">Comisiones del lanzamiento</h2>
              {hayTramos ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void sincronizar()}
                  disabled={accion === 'sincronizar'}
                >
                  {accion === 'sincronizar' ? 'Recalculando…' : 'Sincronizar comisiones'}
                </Button>
              ) : null}
            </div>
            {hayTramos && dinero ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted-foreground">Firme</p>
                    <p className="text-lg font-semibold tabular-nums text-foreground">{formatCurrency(dinero.firme)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">En ventana</p>
                    <p className="text-lg font-semibold tabular-nums text-foreground">
                      {formatCurrency(dinero.enVentana)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Ventas</p>
                    <p className="text-lg font-semibold tabular-nums text-foreground">{formatNumber(dinero.ventas)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Sin importe</p>
                    <p className="text-lg font-semibold tabular-nums text-foreground">
                      {formatNumber(dinero.sinImporte)}
                    </p>
                  </div>
                </div>
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {textoTramos(ajustes.tramos, (n) => formatCurrency(n)).map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
                {dinero.sinImporte > 0 && (
                  <p className="mt-2 text-xs text-amber-500">
                    Hay ventas sin importe leído: no se les puede asignar comisión todavía.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Sin tramos configurados, las ventas de cold calling no generan comisión. Los tramos los cambia quien
                administra la subcuenta o un director.
              </p>
            )}
          </section>

          <section className="dashboard-card p-5">
            <h2 className="text-sm font-semibold text-foreground">Equipo</h2>
            {(stats ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No hay cold callers activas en esta subcuenta.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-2 font-medium">Cold caller</th>
                      <th className="px-2 py-2 text-right font-medium">Asignados</th>
                      <th className="px-2 py-2 text-right font-medium">Por llamar</th>
                      <th className="px-2 py-2 text-right font-medium">Llamados</th>
                      <th className="px-2 py-2 text-right font-medium">Contactados</th>
                      <th className="px-2 py-2 text-right font-medium">Confirmados</th>
                      <th className="px-2 py-2 text-right font-medium">Ventas</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {(stats ?? []).map((s) => (
                      <tr key={s.callerId} className="border-b border-border/60 last:border-0">
                        <td className="px-2 py-2 text-foreground">
                          {s.nombre}
                          {!s.activa && <span className="ml-2 text-2xs text-muted-foreground">inactiva</span>}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatNumber(s.asignados)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatNumber(s.porLlamar)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatNumber(s.llamados)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatNumber(s.contactados)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatNumber(s.confirmados)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{formatNumber(s.ventas)}</td>
                        <td className="px-2 py-2 text-right">
                          {launch.abierto && s.activa && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={accion === `repartir:${s.callerId}`}
                              onClick={() => void repartir(s)}
                            >
                              {accion === `repartir:${s.callerId}`
                                ? 'Repartiendo…'
                                : `Repartir ${formatNumber(ajustes.tanda)}`}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!launch.abierto && (
              <p className="mt-2 text-xs text-muted-foreground">
                Este lanzamiento está cerrado: se consulta, pero no se reparten leads.
              </p>
            )}
          </section>

          <section className="dashboard-card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">Necesitan atención</h2>
              <p className="text-2xs text-muted-foreground">
                Recordatorios vencidos o sin moverse en {data.diasInactivo ?? 7} días
              </p>
            </div>
            {(atencion ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Nada pendiente: ningún lead se ha quedado frío.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-2 font-medium">Lead</th>
                      <th className="px-2 py-2 font-medium">Cold caller</th>
                      <th className="px-2 py-2 font-medium">Motivo</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {(atencion ?? []).map((a) => (
                      <tr key={a.id} className="border-b border-border/60 last:border-0">
                        <td className="px-2 py-2 text-foreground">
                          {a.nombre}
                          {a.phone && <span className="ml-2 text-xs text-muted-foreground">{a.phone}</span>}
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">{a.caller}</td>
                        <td className="px-2 py-2">
                          <span className="text-xs text-amber-600 dark:text-amber-400">
                            {a.motivo === 'recordatorio_vencido'
                              ? 'Recordatorio vencido'
                              : `Sin actividad ${data.diasInactivo ?? 7} días`}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Button variant="ghost" size="sm" onClick={() => setReasignar({ lead: a, caller: a.caller })}>
                            Reasignar
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="dashboard-card p-5">
              <h2 className="text-sm font-semibold text-foreground">Últimos movimientos</h2>
              {(actividad ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Todavía no hay actividad en este lanzamiento.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {(actividad ?? []).map((x) => {
                    const est = estadoDe(x.status)
                    return (
                      <li key={x.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                        <span className="tabular-nums text-muted-foreground">{formatDateTime(x.cuando)}</span>
                        <span className="text-foreground">{x.lead}</span>
                        <span className="text-muted-foreground">· {x.caller}</span>
                        {est && (
                          <span className={cn('rounded border px-1.5 py-0.5 text-2xs', CLASE_TONO[est.tono])}>
                            {est.label}
                          </span>
                        )}
                        {x.porOtraPersona && <span className="text-2xs text-muted-foreground">por {x.actor}</span>}
                        {x.nota && <span className="w-full text-xs text-muted-foreground">{x.nota}</span>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section className="dashboard-card p-5">
              <h2 className="text-sm font-semibold text-foreground">Ventas del lanzamiento</h2>
              {(ventas ?? []).length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Ninguna venta atribuida a este lanzamiento.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-2 py-2 font-medium">Lead</th>
                        <th className="px-2 py-2 font-medium">Cold caller</th>
                        <th className="px-2 py-2 text-right font-medium">Importe</th>
                        <th className="px-2 py-2 font-medium">Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(ventas ?? []).map((v) => (
                        <tr key={v.saleId} className="border-b border-border/60 last:border-0">
                          <td className="px-2 py-2 text-foreground">{v.lead}</td>
                          <td className="px-2 py-2 text-muted-foreground">{v.caller}</td>
                          <td className="px-2 py-2 text-right tabular-nums text-foreground">
                            {formatCurrency(v.importe)}
                          </td>
                          <td className="px-2 py-2 text-muted-foreground">{v.fecha}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {reasignar && (
        <ReasignarLead
          base={base}
          callers={data.callers}
          lead={reasignar.lead}
          caller={reasignar.caller}
          onClose={() => setReasignar(null)}
          onHecho={() => {
            setReasignar(null)
            void cargar(true)
          }}
        />
      )}
    </div>
  )
}

function ReasignarLead({
  base,
  callers,
  lead,
  caller,
  onClose,
  onHecho,
}: {
  base: string
  callers: ManagerResponse['callers']
  lead: Lead
  caller: string
  onClose: () => void
  onHecho: () => void
}) {
  const [callerId, setCallerId] = useState(callers[0]?.id ?? '')
  const [motivo, setMotivo] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const enviar = async () => {
    if (!callerId) {
      setError('Elige a quién se lo pasas')
      return
    }
    if (!motivo.trim()) {
      setError('Escribe por qué se reasigna: queda en la actividad del lead')
      return
    }
    setGuardando(true)
    setError('')
    try {
      const r = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'reasignar', id: lead.id, callerId, motivo }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(j.error || 'No se pudo reasignar')
        return
      }
      toast.success('Lead reasignado')
      onHecho()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de conexión')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Reasignar lead"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Reasignar {lead.nombre}</h2>
            <p className="mt-0.5 text-2xs text-muted-foreground">Ahora lo lleva {caller}</p>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
            Cerrar
          </button>
        </div>
        <label htmlFor="cc-reasignar-caller" className="mt-3 block text-xs text-muted-foreground">
          Nueva cold caller
        </label>
        <select
          id="cc-reasignar-caller"
          value={callerId}
          onChange={(e) => setCallerId(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        >
          {callers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
              {c.activa ? '' : ' (inactiva)'}
            </option>
          ))}
        </select>
        <label htmlFor="cc-reasignar-motivo" className="mt-3 block text-xs text-muted-foreground">
          Motivo
        </label>
        <textarea
          id="cc-reasignar-motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          rows={3}
          placeholder="No la ha llamado en una semana, está de baja…"
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
        />
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => void enviar()} disabled={guardando}>
            {guardando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            Reasignar
          </Button>
        </div>
      </div>
    </div>
  )
}
