'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Download, Loader2, RefreshCw, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchBox } from '@/components/ui/search-box'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, formatNumber } from '@/lib/utils'
import type { LeadDetalle } from './tipos'

// TABLA DE LEADS DE UN LANZAMIENTO. Búsqueda y filtros se resuelven en el servidor (paginado de 50):
// no se trae el lanzamiento entero al navegador. Cada petición cancela la anterior, así que escribir
// rápido no deja una respuesta vieja pisando a la nueva, y se cancela al desmontar.

type Respuesta = { leads: LeadDetalle[]; total: number; pagina: number; porPagina: number }
type Estado = 'todos' | 'confirmados' | 'sin_confirmar'

const DESGLOSE: { clave: keyof NonNullable<LeadDetalle['desglose']>; label: string }[] = [
  { clave: 'independencia', label: 'Independencia' },
  { clave: 'ingresos', label: 'Ingresos' },
  { clave: 'ambicion', label: 'Ambición' },
  { clave: 'edad', label: 'Edad' },
  { clave: 'relacionIA', label: 'Experiencia previa' },
]

const siNo = (v: boolean | null) => (v === null ? '—' : v ? 'Sí' : 'No')

export function TablaLeads({
  tenant,
  launchId,
  anuncios,
  puedeExportar,
}: {
  tenant: string
  launchId: string
  anuncios: string[]
  puedeExportar: boolean
}) {
  const [q, setQ] = useState('')
  const [buscado, setBuscado] = useState('')
  const [estado, setEstado] = useState<Estado>('todos')
  const [anuncio, setAnuncio] = useState('')
  const [pagina, setPagina] = useState(0)
  const [data, setData] = useState<Respuesta | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<LeadDetalle | null>(null)
  const [exportando, setExportando] = useState(false)
  const [intento, setIntento] = useState(0)
  const abort = useRef<AbortController | null>(null)

  // El texto se aplica 300 ms después de dejar de escribir: una petición por búsqueda, no por tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      setBuscado(q.trim())
      setPagina(0)
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  const parametros = useCallback(() => {
    const sp = new URLSearchParams({ launch: launchId })
    if (buscado) sp.set('q', buscado)
    if (estado !== 'todos') sp.set('estado', estado)
    if (anuncio) sp.set('anuncio', anuncio)
    return sp
  }, [launchId, buscado, estado, anuncio])

  useEffect(() => {
    abort.current?.abort()
    const ac = new AbortController()
    abort.current = ac
    setCargando(true)
    setError(null)
    const sp = parametros()
    sp.set('pagina', String(pagina))
    fetch(`/api/${tenant}/evergreen/lanzamiento/leads?${sp}`, { signal: ac.signal })
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'No se pudieron leer los leads')
        setData(j as Respuesta)
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message || 'Error de conexión')
      })
      .finally(() => {
        if (abort.current === ac) setCargando(false)
      })
    return () => ac.abort()
  }, [tenant, parametros, pagina, intento])

  const exportar = async () => {
    setExportando(true)
    try {
      const sp = parametros()
      sp.set('formato', 'csv')
      const r = await fetch(`/api/${tenant}/evergreen/lanzamiento/leads?${sp}`)
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.error || 'No se pudo exportar')
      }
      const blob = await r.blob()
      const nombre = /filename="([^"]+)"/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? 'leads.csv'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nombre
      a.click()
      URL.revokeObjectURL(url)
      if (r.headers.get('X-Exportacion-Truncada') === '1') {
        toast.warning('La exportación tiene un máximo de 5.000 filas: el fichero no los incluye todos.')
      } else toast.success('Leads exportados')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo exportar')
    } finally {
      setExportando(false)
    }
  }

  const total = data?.total ?? 0
  const porPagina = data?.porPagina ?? 50
  const paginas = Math.max(1, Math.ceil(total / porPagina))
  const hayFiltro = Boolean(buscado) || estado !== 'todos' || Boolean(anuncio)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox
          value={q}
          onChange={setQ}
          placeholder="Buscar por nombre, email o teléfono"
          className="w-full sm:w-80"
        />
        <label className="sr-only" htmlFor="lz-estado">
          Estado
        </label>
        <select
          id="lz-estado"
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value as Estado)
            setPagina(0)
          }}
          className="h-9 rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="todos">Todos</option>
          <option value="confirmados">Confirmaron asistencia</option>
          <option value="sin_confirmar">Sin confirmar</option>
        </select>
        {anuncios.length > 0 && (
          <>
            <label className="sr-only" htmlFor="lz-anuncio">
              Anuncio
            </label>
            <select
              id="lz-anuncio"
              value={anuncio}
              onChange={(e) => {
                setAnuncio(e.target.value)
                setPagina(0)
              }}
              className="h-9 max-w-[16rem] rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="">Todos los anuncios</option>
              {anuncios.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </>
        )}
        <span className="ml-auto text-sm text-muted-foreground" aria-live="polite">
          {cargando ? 'Buscando…' : `${formatNumber(total)} ${total === 1 ? 'lead' : 'leads'}`}
        </span>
        {puedeExportar && (
          <Button variant="outline" size="sm" onClick={() => void exportar()} disabled={exportando || total === 0}>
            {exportando ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-3.5 w-3.5" />
            )}
            Exportar CSV
          </Button>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-300">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" /> {error}
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => setIntento((n) => n + 1)}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reintentar
          </Button>
        </div>
      )}

      {!error && cargando && !data && (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-11 w-full" />
          ))}
        </div>
      )}

      {!error && data && data.leads.length === 0 && !cargando && (
        <EmptyState
          icon={Users}
          className="rounded-lg border border-dashed border-border py-12"
          title={hayFiltro ? 'Ningún lead coincide con el filtro' : 'Todavía no hay leads apuntados'}
          description={
            hayFiltro
              ? 'Prueba con otro texto o quita los filtros.'
              : 'Los leads entran por el webhook de GHL. Revisa la pestaña Conexión para ver las direcciones y si ha llegado algún evento.'
          }
        />
      )}

      {!error && data && data.leads.length > 0 && (
        <div className={`overflow-x-auto rounded-lg border border-border bg-card ${cargando ? 'opacity-60' : ''}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">Lead</th>
                <th scope="col" className="px-3 py-2 font-medium">Se apuntó</th>
                <th scope="col" className="px-3 py-2 font-medium">Calidad</th>
                <th scope="col" className="px-3 py-2 font-medium">Confirmó</th>
                <th scope="col" className="px-3 py-2 font-medium">Agendó</th>
                <th scope="col" className="px-3 py-2 font-medium">Compró</th>
                <th scope="col" className="px-3 py-2 font-medium">Anuncio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.leads.map((l) => (
                <tr key={l.id} className="hover:bg-muted/40">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setDetalle(l)}
                      className="text-left font-medium text-foreground underline-offset-2 hover:underline focus-visible:underline"
                    >
                      {l.nombre || 'Sin nombre'}
                    </button>
                    <span className="block text-xs text-muted-foreground">{l.email ?? l.phone ?? 'Sin contacto'}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatDateTime(l.fecha)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {l.quality === null ? (
                      <span className="text-muted-foreground">Sin encuesta</span>
                    ) : (
                      `${formatNumber(l.quality, { maximumFractionDigits: 1 })}/10`
                    )}
                  </td>
                  <td className="px-3 py-2">{l.confirmado ? <Badge variant="success">Sí</Badge> : 'No'}</td>
                  <td className="px-3 py-2">{siNo(l.agendo)}</td>
                  <td className="px-3 py-2">{l.compro ? <Badge variant="success">Sí</Badge> : siNo(l.compro)}</td>
                  <td className="max-w-[14rem] truncate px-3 py-2 text-muted-foreground" title={l.anuncio ?? undefined}>
                    {l.anuncio ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && paginas > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={pagina === 0 || cargando} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </Button>
          <span className="text-muted-foreground">
            Página {pagina + 1} de {formatNumber(paginas)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={pagina + 1 >= paginas || cargando}
            onClick={() => setPagina((p) => p + 1)}
          >
            Siguiente
          </Button>
        </div>
      )}

      <Sheet open={Boolean(detalle)} onOpenChange={(o) => !o && setDetalle(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {detalle && (
            <>
              <SheetHeader>
                <SheetTitle>{detalle.nombre || 'Sin nombre'}</SheetTitle>
                <SheetDescription>
                  {[detalle.email, detalle.phone].filter(Boolean).join(' · ') || 'Sin datos de contacto'}
                </SheetDescription>
              </SheetHeader>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Se apuntó</dt>
                  <dd className="text-foreground">{formatDateTime(detalle.fecha)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Confirmó asistencia</dt>
                  <dd className="text-foreground">{siNo(detalle.confirmado)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Agendó llamada</dt>
                  <dd className="text-foreground">{siNo(detalle.agendo)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Compró</dt>
                  <dd className="text-foreground">{siNo(detalle.compro)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Anuncio · campaña</dt>
                  <dd className="break-words text-foreground">
                    {detalle.anuncio ?? '—'} · {detalle.campana ?? '—'}
                  </dd>
                </div>
              </dl>

              <h4 className="mt-6 text-sm font-semibold text-foreground">
                Calidad{' '}
                {detalle.quality !== null && (
                  <span className="font-normal text-muted-foreground">
                    {formatNumber(detalle.quality, { maximumFractionDigits: 1 })}/10
                  </span>
                )}
              </h4>
              {detalle.desglose ? (
                <ul className="mt-2 space-y-1 text-sm">
                  {DESGLOSE.map((d) => (
                    <li key={d.clave} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{d.label}</span>
                      <span className="text-foreground">
                        {formatNumber(detalle.desglose![d.clave], { maximumFractionDigits: 1 })}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">No ha contestado la encuesta: no tiene nota.</p>
              )}

              <h4 className="mt-6 text-sm font-semibold text-foreground">Respuestas de la encuesta</h4>
              {detalle.respuestas.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">Sin respuestas guardadas.</p>
              ) : (
                <dl className="mt-2 space-y-3 text-sm">
                  {detalle.respuestas.map((r, i) => (
                    <div key={i}>
                      <dt className="text-xs text-muted-foreground">{r.q}</dt>
                      <dd className="whitespace-pre-wrap break-words text-foreground">{r.a}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
