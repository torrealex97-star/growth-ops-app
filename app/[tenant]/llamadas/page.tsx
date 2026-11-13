'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Bell, Eye, Info, Loader2, Mail, Phone, PhoneCall, RefreshCw, Wallet } from 'lucide-react'
import { toast } from 'sonner'
import { CLASE_TONO, textoTramos, type Estado, type Lead, type ListaResponse } from '@/components/cold-calling/tipos'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchBox } from '@/components/ui/search-box'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useTenant } from '@/lib/tenant-context'
import { cn, formatCurrency, formatDate, formatDateTime, formatNumber, normalizeText, phoneMatches } from '@/lib/utils'

// MIS LLAMADAS — la pantalla de cada día de una cold caller.
//
// Orden pensado para trabajar: primero qué tengo que hacer ahora (recordatorios vencidos y leads por
// llamar), luego la lista, y al lado cuánto llevo ganado. Marcar un estado es un clic y se guarda
// solo; las notas se guardan al salir del campo y el borrador sobrevive a una recarga.
//
// Se refresca al volver a la pestaña y con el botón, NO con un temporizador: la lista solo cambia
// cuando ella hace algo o le reparten leads, y un sondeo continuo por persona no cabe en el plan
// gratuito de la base de datos.

const FILTROS = [
  { id: 'trabajar', label: 'Por trabajar' },
  { id: 'recordatorio', label: 'Con recordatorio' },
  { id: 'confirmados', label: 'Confirmados' },
  { id: 'todos', label: 'Todos' },
] as const
type Filtro = (typeof FILTROS)[number]['id']

const CERRADOS = new Set(['no_interesado', 'no_existe', 'asiste', 'no_asiste'])
const CONFIRMA = new Set(['confirmado', 'asiste'])

export default function LlamadasPage() {
  return (
    <Suspense fallback={<Esqueleto />}>
      <Lista />
    </Suspense>
  )
}

function Esqueleto() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Cargando tus llamadas">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  )
}

/** Valor para <input type="datetime-local"> en la hora local de quien mira. */
function aLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

const claveBorrador = (tenant: string, id: string) => `cc-nota:${tenant}:${id}`
function leerBorrador(tenant: string, id: string): string | null {
  try {
    return window.localStorage.getItem(claveBorrador(tenant, id))
  } catch {
    return null
  }
}
function guardarBorrador(tenant: string, id: string, texto: string | null) {
  try {
    if (texto === null) window.localStorage.removeItem(claveBorrador(tenant, id))
    else window.localStorage.setItem(claveBorrador(tenant, id), texto)
  } catch {
    /* sin almacenamiento local (modo privado): la nota se guarda igual al salir del campo */
  }
}

function Lista() {
  const tenant = useTenant()
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const launchParam = sp.get('launch')
  const como = sp.get('como')

  const [data, setData] = useState<ListaResponse | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('trabajar')
  const [q, setQ] = useState('')
  const [abierto, setAbierto] = useState<Lead | null>(null)
  const [guardando, setGuardando] = useState<string | null>(null)
  const [pidiendo, setPidiendo] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const base = `/api/${tenant}/evergreen/cold-calling`

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
        if (como) p.set('como', como)
        const r = await fetch(p.size ? `${base}?${p}` : base, { signal: ac.signal })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'No se pudo cargar tu lista')
        setData(j as ListaResponse)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Error de conexión')
      } finally {
        if (abort.current === ac) setCargando(false)
      }
    },
    [base, launchParam, como]
  )

  useEffect(() => {
    void cargar()
    return () => abort.current?.abort()
  }, [cargar])

  // Al volver a la pestaña (p. ej. tras colgar una llamada) se trae lo último, sin esqueleto.
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible' && !abierto) void cargar(true)
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [cargar, abierto])

  const soloLectura = data?.soloLectura ?? false
  const estados = useMemo(() => data?.estados ?? [], [data?.estados])
  const estadoDe = useCallback((id: string): Estado | undefined => estados.find((e) => e.id === id), [estados])

  /** Guarda un cambio de un lead y actualiza la fila en pantalla sin recargar toda la lista. */
  const guardar = async (
    lead: Lead,
    cambios: { status?: string; notes?: string | null; recordatorioAt?: string | null }
  ) => {
    if (soloLectura) return false
    setGuardando(lead.id)
    try {
      const r = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'lead', id: lead.id, esperado: lead.updatedAt, ...cambios }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(j.error || 'No se pudo guardar')
        // 409 = alguien lo cambió (una reasignación, otra pestaña): se trae la versión buena.
        if (r.status === 409) void cargar(true)
        return false
      }
      const actualizado: Lead = {
        ...lead,
        ...(cambios.status ? { status: cambios.status as Lead['status'] } : {}),
        ...(cambios.notes !== undefined ? { notes: cambios.notes } : {}),
        ...(cambios.recordatorioAt !== undefined ? { recordatorioAt: cambios.recordatorioAt } : {}),
        updatedAt: j.lead?.updatedAt ?? lead.updatedAt,
      }
      setData((d) => (d ? { ...d, leads: d.leads?.map((l) => (l.id === lead.id ? actualizado : l)) } : d))
      setAbierto((a) => (a?.id === lead.id ? actualizado : a))
      // Un cambio de estado mueve los contadores y el dinero: se refrescan por detrás.
      if (cambios.status) void cargar(true)
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de conexión')
      return false
    } finally {
      setGuardando(null)
    }
  }

  const pedirMas = async () => {
    setPidiendo(true)
    try {
      const r = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'pedir_mas', launch: data?.launch?.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) return void toast.error(j.error || 'No se pudieron pedir más leads')
      if (j.asignados > 0) toast.success(`${formatNumber(j.asignados)} leads nuevos en tu lista`)
      else toast.info('Ahora mismo no quedan leads por repartir en este lanzamiento')
      setFiltro('trabajar')
      await cargar(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error de conexión')
    } finally {
      setPidiendo(false)
    }
  }

  const leads = useMemo(() => data?.leads ?? [], [data?.leads])
  const ahora = Date.now()
  const vencidos = leads.filter(
    (l) => l.recordatorioAt && Date.parse(l.recordatorioAt) <= ahora && !CERRADOS.has(l.status)
  )
  const visibles = useMemo(() => {
    const texto = normalizeText(q.trim())
    return leads
      .filter((l) => {
        if (filtro === 'trabajar') return !CERRADOS.has(l.status) && !CONFIRMA.has(l.status)
        if (filtro === 'recordatorio') return Boolean(l.recordatorioAt)
        if (filtro === 'confirmados') return CONFIRMA.has(l.status)
        return true
      })
      .filter(
        (l) =>
          !texto ||
          normalizeText(l.nombre).includes(texto) ||
          normalizeText(l.email ?? '').includes(texto) ||
          phoneMatches(l.phone, q)
      )
      .sort((a, b) => {
        // Arriba lo que toca ya: recordatorio vencido, luego sin llamar, luego el resto por nota.
        const va = a.recordatorioAt && Date.parse(a.recordatorioAt) <= ahora ? 0 : a.status === 'pendiente' ? 1 : 2
        const vb = b.recordatorioAt && Date.parse(b.recordatorioAt) <= ahora ? 0 : b.status === 'pendiente' ? 1 : 2
        return va - vb || (b.quality ?? -1) - (a.quality ?? -1)
      })
    // `ahora` cambia en cada render; el orden solo debe recalcularse cuando cambian los datos o el filtro.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, filtro, q])

  const cuenta = (f: Filtro) =>
    leads.filter((l) =>
      f === 'trabajar'
        ? !CERRADOS.has(l.status) && !CONFIRMA.has(l.status)
        : f === 'recordatorio'
          ? Boolean(l.recordatorioAt)
          : f === 'confirmados'
            ? CONFIRMA.has(l.status)
            : true
    ).length

  const cambiarLanzamiento = (id: string) => {
    const next = new URLSearchParams(sp.toString())
    next.set('launch', id)
    router.replace(`${pathname}?${next}`, { scroll: false })
  }

  if (data?.sinLista) {
    return (
      <EmptyState
        icon={PhoneCall}
        title="Esta es la pantalla de las cold callers"
        description="Tú gestionas el equipo: desde el panel de cold calling puedes repartir leads y abrir la lista de cada persona."
        action={
          <Button asChild>
            <Link href={`/${tenant}/cold-calling`}>Ir al panel del equipo</Link>
          </Button>
        }
      />
    )
  }

  const stats = data?.stats
  const dinero = data?.dinero
  const objetivo = data?.objetivoConfirmados ?? null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {soloLectura ? `Llamadas de ${data?.nombreVista ?? ''}` : 'Mis llamadas'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data?.launch
              ? `${data.launch.label} · evento del ${formatDate(data.launch.fecha)}`
              : 'Tus leads, tus números y lo que llevas ganado.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(data?.lanzamientos.length ?? 0) > 1 && (
            <>
              <label htmlFor="cc-lanzamiento" className="sr-only">
                Lanzamiento
              </label>
              <select
                id="cc-lanzamiento"
                value={data?.launch?.id ?? ''}
                onChange={(e) => cambiarLanzamiento(e.target.value)}
                className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              >
                {data?.lanzamientos.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                    {l.abierto ? ' (abierto)' : ''}
                  </option>
                ))}
              </select>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => void cargar()} disabled={cargando}>
            <RefreshCw className={cn('mr-1.5 h-4 w-4', cargando && 'animate-spin')} /> Actualizar
          </Button>
        </div>
      </div>

      {soloLectura && (
        <p className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-700 dark:text-blue-300">
          <Eye className="h-4 w-4 shrink-0" />
          <span>
            Estás viendo la lista de otra persona en solo lectura.{' '}
            <Link href={`/${tenant}/cold-calling`} className="underline underline-offset-2">
              Volver al panel del equipo
            </Link>
          </span>
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-300"
        >
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {data ? 'No se pudo actualizar; ves lo último que se leyó' : 'No se puede mostrar tu lista'}: {error}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void cargar()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reintentar
          </Button>
        </div>
      )}

      {!data && cargando && <Esqueleto />}

      {data && !data.launch && (
        <EmptyState
          icon={PhoneCall}
          title="Todavía no hay ningún lanzamiento abierto"
          description="Los leads para llamar salen de los apuntados a un lanzamiento. Cuando se abra uno, podrás pedir tu primera tanda aquí."
        />
      )}

      {data?.launch && stats !== undefined && (
        <>
          {/* ── Lo que toca ahora ──────────────────────────────────────── */}
          {vencidos.length > 0 && (
            <button
              type="button"
              onClick={() => setFiltro('recordatorio')}
              className="flex w-full items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-left text-sm text-amber-700 dark:text-amber-300"
            >
              <Bell className="h-4 w-4 shrink-0" />
              <span>
                <strong>
                  {vencidos.length === 1
                    ? 'Tienes 1 recordatorio para ahora'
                    : `Tienes ${formatNumber(vencidos.length)} recordatorios para ahora`}
                </strong>
                :{' '}
                {vencidos
                  .slice(0, 3)
                  .map((l) => l.nombre)
                  .join(', ')}
                {vencidos.length > 3 ? '…' : ''}
              </span>
            </button>
          )}

          <div className="grid gap-4 lg:grid-cols-3">
            {/* ── Números ───────────────────────────────────────────── */}
            <section aria-label="Tus números" className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:col-span-2">
              {[
                {
                  label: 'Por llamar',
                  valor: stats?.porLlamar ?? 0,
                  nota: `de ${formatNumber(stats?.asignados ?? 0)} en tu lista`,
                },
                {
                  label: 'Llamados',
                  valor: stats?.llamados ?? 0,
                  nota: `${formatNumber(stats?.intentos ?? 0)} intentos en total`,
                },
                {
                  label: 'Confirmados',
                  valor: stats?.confirmados ?? 0,
                  nota: objetivo
                    ? `Objetivo: ${formatNumber(objetivo)}`
                    : `${formatNumber(stats?.contactados ?? 0)} con conversación`,
                },
                { label: 'Ventas', valor: stats?.ventas ?? 0, nota: 'De leads que llamaste antes de la venta' },
              ].map((k) => (
                <div key={k.label} className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">{k.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{formatNumber(k.valor)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{k.nota}</p>
                </div>
              ))}
            </section>

            {/* ── Tu dinero ─────────────────────────────────────────── */}
            <section aria-labelledby="titulo-dinero" className="rounded-lg border border-border bg-card p-4">
              <h2 id="titulo-dinero" className="flex items-center gap-2 font-semibold text-foreground">
                <Wallet className="h-4 w-4" /> {soloLectura ? 'Su dinero' : 'Tu dinero'}
              </h2>
              {dinero?.estado === 'ok' && (
                <>
                  <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">
                    {formatCurrency(dinero.firme + dinero.enVentana)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Comisión generada en este lanzamiento por {formatNumber(dinero.ventas)}{' '}
                    {dinero.ventas === 1 ? 'venta' : 'ventas'}.
                  </p>
                  <dl className="mt-3 space-y-1 text-sm">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Firme</dt>
                      <dd className="tabular-nums text-foreground">{formatCurrency(dinero.firme)}</dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Aún en plazo de devolución</dt>
                      <dd className="tabular-nums text-foreground">{formatCurrency(dinero.enVentana)}</dd>
                    </div>
                  </dl>
                  <p className="mt-2 text-xs text-muted-foreground">
                    «En plazo de devolución» puede perderse si el cliente desiste. El pago de cada mes está en{' '}
                    <Link href={`/${tenant}/comisiones`} className="underline underline-offset-2">
                      Comisiones
                    </Link>
                    .
                  </p>
                </>
              )}
              {dinero?.estado === 'sin_tramos' && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Aún no se han configurado las comisiones de cold calling en esta cuenta, así que no hay importe que
                  enseñar. Llevas {formatNumber(dinero.ventas)} {dinero.ventas === 1 ? 'venta' : 'ventas'} que cuentan.
                </p>
              )}
              {dinero?.estado === 'exenta' && (
                <p className="mt-2 text-sm text-muted-foreground">Tu perfil no lleva comisión por venta.</p>
              )}
              {(data.tramos?.length ?? 0) > 0 && (
                <details className="mt-3 text-xs text-muted-foreground">
                  <summary className="cursor-pointer text-foreground">Cómo se calcula</summary>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {textoTramos(data.tramos ?? [], (n) => formatCurrency(n)).map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                    <li>Una venta te cuenta si registraste una llamada a ese lead antes de que comprara.</li>
                    <li>Un WhatsApp sin llamada no cuenta. Una reserva cuenta cuando se completa.</li>
                  </ul>
                </details>
              )}
            </section>
          </div>

          {/* ── Lista ──────────────────────────────────────────────────── */}
          <section aria-labelledby="titulo-leads" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="titulo-leads" className="sr-only">
                Leads
              </h2>
              <div role="tablist" aria-label="Filtrar leads" className="flex flex-wrap gap-1">
                {FILTROS.map((f) => (
                  <button
                    key={f.id}
                    role="tab"
                    aria-selected={filtro === f.id}
                    onClick={() => setFiltro(f.id)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm transition-colors',
                      filtro === f.id
                        ? 'border-brand-500 bg-brand-500/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {f.label} <span className="tabular-nums">{formatNumber(cuenta(f.id))}</span>
                  </button>
                ))}
              </div>
              <SearchBox
                value={q}
                onChange={setQ}
                placeholder="Buscar nombre o teléfono"
                className="ml-auto w-full sm:w-64"
              />
            </div>

            {!soloLectura && data.pedirMas && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-3">
                <p className="text-sm text-muted-foreground">
                  {data.pedirMas.disponible
                    ? `Te quedan ${formatNumber(data.pedirMas.porLlamar)} por llamar. Puedes pedir ${formatNumber(data.pedirMas.tanda)} más.`
                    : data.pedirMas.motivo}
                </p>
                <Button size="sm" onClick={() => void pedirMas()} disabled={!data.pedirMas.disponible || pidiendo}>
                  {pidiendo ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <PhoneCall className="mr-1.5 h-4 w-4" />
                  )}
                  Dame más leads
                </Button>
              </div>
            )}

            {data.leadsTruncados && (
              <p className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> La lista es muy larga y solo se muestran los más
                recientes.
              </p>
            )}

            {visibles.length === 0 ? (
              <EmptyState
                icon={PhoneCall}
                className="rounded-lg border border-dashed border-border py-12"
                title={
                  leads.length === 0
                    ? 'Aún no tienes leads'
                    : q
                      ? 'Ningún lead coincide con la búsqueda'
                      : 'No hay nada en este filtro'
                }
                description={
                  leads.length === 0
                    ? soloLectura
                      ? 'Todavía no se le ha repartido ningún lead de este lanzamiento.'
                      : 'Pulsa «Dame más leads» para recibir tu primera tanda.'
                    : filtro === 'trabajar' && !q
                      ? 'Has trabajado todos tus leads. Pide más cuando quieras.'
                      : 'Prueba con otro filtro.'
                }
              />
            ) : (
              <ul className="space-y-2">
                {visibles.map((l) => {
                  const est = estadoDe(l.status)
                  const vencido = l.recordatorioAt && Date.parse(l.recordatorioAt) <= ahora
                  return (
                    <li key={l.id} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => setAbierto(l)}
                            className="text-left font-medium text-foreground underline-offset-2 hover:underline focus-visible:underline"
                          >
                            {l.nombre}
                          </button>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            {l.phone ? (
                              <a
                                href={`tel:${l.phone}`}
                                className="inline-flex items-center gap-1 text-brand-500 underline-offset-2 hover:underline"
                              >
                                <Phone className="h-3.5 w-3.5" /> {l.phone}
                              </a>
                            ) : (
                              <span className="text-muted-foreground">Sin teléfono</span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {l.quality === null
                                ? 'Sin nota'
                                : `Nota ${formatNumber(l.quality, { maximumFractionDigits: 1 })}/10`}
                              {l.intentos > 0
                                ? ` · ${formatNumber(l.intentos)} ${l.intentos === 1 ? 'intento' : 'intentos'}`
                                : ''}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {l.compro && <Badge variant="success">Compró</Badge>}
                          {l.recordatorioAt && (
                            <span
                              className={cn(
                                'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs',
                                vencido ? CLASE_TONO.aviso : CLASE_TONO.neutro
                              )}
                            >
                              <Bell className="h-3 w-3" /> {formatDateTime(l.recordatorioAt)}
                            </span>
                          )}
                          <span
                            className={cn(
                              'rounded-md border px-2 py-0.5 text-xs font-medium',
                              CLASE_TONO[est?.tono ?? 'neutro']
                            )}
                          >
                            {est?.label ?? l.status}
                          </span>
                        </div>
                      </div>
                      {l.notes && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{l.notes}</p>}
                      {!soloLectura && (
                        <div
                          className="mt-2 flex flex-wrap gap-1.5"
                          role="group"
                          aria-label={`Marcar el estado de ${l.nombre}`}
                        >
                          {estados
                            .filter((e) => e.id !== 'pendiente' && e.id !== l.status)
                            .slice(0, 5)
                            .map((e) => (
                              <Button
                                key={e.id}
                                variant="outline"
                                size="sm"
                                title={e.ayuda}
                                disabled={guardando === l.id}
                                onClick={() => void guardar(l, { status: e.id })}
                              >
                                {e.label}
                              </Button>
                            ))}
                          <Button variant="ghost" size="sm" onClick={() => setAbierto(l)}>
                            Más…
                          </Button>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          {/* ── Ranking ────────────────────────────────────────────────── */}
          {(data.ranking?.length ?? 0) > 1 && (
            <section aria-labelledby="titulo-ranking" className="rounded-lg border border-border bg-card p-4">
              <h2 id="titulo-ranking" className="font-semibold text-foreground">
                Ranking del equipo
              </h2>
              <p className="text-xs text-muted-foreground">Por ventas, y a igualdad por confirmados.</p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th scope="col" className="py-1.5 pr-3 font-medium">
                        #
                      </th>
                      <th scope="col" className="py-1.5 pr-3 font-medium">
                        Persona
                      </th>
                      <th scope="col" className="py-1.5 pr-3 font-medium">
                        Llamados
                      </th>
                      <th scope="col" className="py-1.5 pr-3 font-medium">
                        Confirmados
                      </th>
                      <th scope="col" className="py-1.5 pr-3 font-medium">
                        Ventas
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.ranking?.map((r) => (
                      <tr
                        key={`${r.posicion}-${r.nombre}`}
                        className={r.soyYo ? 'bg-brand-500/5 font-medium' : undefined}
                      >
                        <td className="py-1.5 pr-3 tabular-nums">{r.posicion}</td>
                        <td className="py-1.5 pr-3">
                          {r.nombre}
                          {r.soyYo && !soloLectura ? ' (tú)' : ''}
                        </td>
                        <td className="py-1.5 pr-3 tabular-nums">{formatNumber(r.llamados)}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{formatNumber(r.confirmados)}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{formatNumber(r.ventas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      <FichaLead
        key={abierto?.id ?? 'ninguno'}
        tenant={tenant}
        lead={abierto}
        estados={estados}
        soloLectura={soloLectura}
        guardando={guardando !== null}
        onCerrar={() => setAbierto(null)}
        onGuardar={guardar}
      />
    </div>
  )
}

function FichaLead({
  tenant,
  lead,
  estados,
  soloLectura,
  guardando,
  onCerrar,
  onGuardar,
}: {
  tenant: string
  lead: Lead | null
  estados: Estado[]
  soloLectura: boolean
  guardando: boolean
  onCerrar: () => void
  onGuardar: (
    lead: Lead,
    cambios: { status?: string; notes?: string | null; recordatorioAt?: string | null }
  ) => Promise<boolean>
}) {
  // El borrador local gana a la nota guardada: es lo que estaba escribiendo cuando se fue la página.
  const [nota, setNota] = useState(() => (lead ? (leerBorrador(tenant, lead.id) ?? lead.notes ?? '') : ''))
  const [cuando, setCuando] = useState(() => aLocal(lead?.recordatorioAt ?? null))
  if (!lead) return <Sheet open={false} />

  const notaSucia = nota.trim() !== (lead.notes ?? '')
  const guardarNota = async () => {
    if (!notaSucia) return guardarBorrador(tenant, lead.id, null)
    if (await onGuardar(lead, { notes: nota.trim() || null })) guardarBorrador(tenant, lead.id, null)
  }
  const guardarRecordatorio = (valor: string) => {
    setCuando(valor)
    void onGuardar(lead, { recordatorioAt: valor ? new Date(valor).toISOString() : null })
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onCerrar()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{lead.nombre}</SheetTitle>
          <SheetDescription>
            En tu lista desde el {formatDate(lead.assignedAt)}
            {lead.intentos > 0
              ? ` · ${formatNumber(lead.intentos)} ${lead.intentos === 1 ? 'intento' : 'intentos'}`
              : ''}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-2 text-sm">
          {lead.phone && (
            <a
              href={`tel:${lead.phone}`}
              className="flex items-center gap-2 text-brand-500 underline-offset-2 hover:underline"
            >
              <Phone className="h-4 w-4" /> {lead.phone}
            </a>
          )}
          {lead.email && (
            <a
              href={`mailto:${lead.email}`}
              className="flex items-center gap-2 break-all text-brand-500 underline-offset-2 hover:underline"
            >
              <Mail className="h-4 w-4 shrink-0" /> {lead.email}
            </a>
          )}
        </div>

        <fieldset className="mt-6" disabled={soloLectura || guardando}>
          <legend className="text-sm font-semibold text-foreground">Estado</legend>
          <div className="mt-2 grid gap-1.5">
            {estados.map((e) => (
              <button
                key={e.id}
                type="button"
                aria-pressed={lead.status === e.id}
                onClick={() => lead.status !== e.id && void onGuardar(lead, { status: e.id })}
                className={cn(
                  'rounded-md border px-3 py-2 text-left text-sm transition-colors disabled:opacity-60',
                  lead.status === e.id ? CLASE_TONO[e.tono] : 'border-border hover:bg-muted'
                )}
              >
                <span className="font-medium">{e.label}</span>
                <span className="block text-xs text-muted-foreground">{e.ayuda}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="mt-6">
          <label htmlFor="cc-nota" className="text-sm font-semibold text-foreground">
            Notas
          </label>
          <Textarea
            id="cc-nota"
            className="mt-2 min-h-[110px]"
            value={nota}
            maxLength={4000}
            disabled={soloLectura}
            placeholder="Qué te ha dicho, a qué hora llamarle…"
            onChange={(e) => {
              setNota(e.target.value)
              guardarBorrador(tenant, lead.id, e.target.value)
            }}
            onBlur={() => void guardarNota()}
          />
          {!soloLectura && (
            <p className="mt-1 text-xs text-muted-foreground" aria-live="polite">
              {notaSucia ? 'Sin guardar: se guarda al salir del campo.' : 'Guardado.'}
            </p>
          )}
        </div>

        <div className="mt-6">
          <label htmlFor="cc-recordatorio" className="text-sm font-semibold text-foreground">
            Recordatorio
          </label>
          <div className="mt-2 flex items-center gap-2">
            <input
              id="cc-recordatorio"
              type="datetime-local"
              value={cuando}
              disabled={soloLectura || guardando}
              onChange={(e) => guardarRecordatorio(e.target.value)}
              className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm"
            />
            {cuando && !soloLectura && (
              <Button variant="ghost" size="sm" onClick={() => guardarRecordatorio('')} disabled={guardando}>
                Quitar
              </Button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Cuando llegue la hora, el lead sube arriba de tu lista con un aviso.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
