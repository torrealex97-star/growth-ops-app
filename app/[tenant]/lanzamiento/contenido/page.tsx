'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowLeft, Copy, Loader2, Plus, Trash2 } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { CANALES, ESTADOS, fechaDePieza, type PiezaContenido } from '@/lib/launch/contenido'

// CONTENIDO DEL LANZAMIENTO: calendario de la nutrición multicanal (email, WhatsApp, stories...) y
// descargables. Las piezas se fechan respecto al evento, así que «Copiar del anterior» trae la
// secuencia ya estandarizada. Solo admin/director editan; el resto lo ve.

type Lanzamiento = { id: string; label: string; fecha: string; abierto: boolean }

const ETIQUETA_CANAL: Record<string, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  encuesta: 'Encuesta',
  winners: 'Bienvenidas',
  grabar: 'Vídeo a grabar',
  stories: 'Stories',
  reel: 'Reel',
  post: 'Post',
  directo: 'Directo',
  otro: 'Otro',
}

const VACIO = { tipo: 'publicacion', canal: 'whatsapp', dia: '', hora: '', titulo: '', texto: '', enlace: '' }

export default function ContenidoLanzamientoPage() {
  const tenant = useTenant()
  const [cal, setCal] = useState<Lanzamiento[]>([])
  const [launchId, setLaunchId] = useState('')
  const [piezas, setPiezas] = useState<PiezaContenido[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(VACIO)
  const [guardando, setGuardando] = useState(false)

  const base = `/api/${tenant}/evergreen/lanzamiento`

  const cargarPiezas = useCallback(
    async (id: string, señal?: AbortSignal) => {
      setError(null)
      try {
        const r = await fetch(`${base}/contenido?launch=${id}`, { signal: señal })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'No se pudo leer el contenido')
        setPiezas(j.piezas as PiezaContenido[])
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : 'Error de conexión')
      }
    },
    [base]
  )

  useEffect(() => {
    const ac = new AbortController()
    ;(async () => {
      try {
        const r = await fetch(base, { signal: ac.signal })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'No se pudo leer el calendario')
        const lista = (j.calendario ?? []) as Lanzamiento[]
        setCal(lista)
        const inicial = (j.activo as Lanzamiento | null)?.id ?? lista[0]?.id ?? ''
        setLaunchId(inicial)
        if (inicial) await cargarPiezas(inicial, ac.signal)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : 'Error de conexión')
      } finally {
        setCargando(false)
      }
    })()
    return () => ac.abort()
  }, [base, cargarPiezas])

  const accion = async (body: Record<string, unknown>) => {
    setGuardando(true)
    setError(null)
    try {
      const r = await fetch(`${base}/contenido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launchId, ...body }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'No se pudo guardar')
      await cargarPiezas(launchId)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de conexión')
      return false
    } finally {
      setGuardando(false)
    }
  }

  const crear = async () => {
    const datos = {
      tipo: form.tipo,
      canal: form.canal,
      dia: form.tipo === 'descargable' || form.dia === '' ? null : Number(form.dia),
      hora: form.hora || null,
      titulo: form.titulo,
      texto: form.texto || null,
      enlace: form.enlace || null,
    }
    if (await accion({ accion: 'crear', datos })) setForm(VACIO)
  }

  const lanz = cal.find((l) => l.id === launchId)
  const publicaciones = piezas.filter((p) => p.tipo === 'publicacion')
  const descargables = piezas.filter((p) => p.tipo === 'descargable')
  const otros = cal.filter((l) => l.id !== launchId)

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${tenant}/lanzamiento`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Lanzamientos
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-foreground">Contenido del lanzamiento</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Qué se publica y cuándo (respecto al día del evento) en cada canal, y los descargables.
        </p>
      </div>

      {cargando && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      )}

      {error && (
        <p className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          <AlertTriangle className="h-4 w-4" /> {error}
        </p>
      )}

      {!cargando && cal.length === 0 && (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Aún no hay lanzamientos. Programa uno en el panel de Lanzamientos para planificar su contenido.
        </p>
      )}

      {!cargando && cal.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={launchId}
              onChange={(e) => {
                setLaunchId(e.target.value)
                void cargarPiezas(e.target.value)
              }}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            >
              {cal.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label} · {l.fecha}
                </option>
              ))}
            </select>
            {otros.length > 0 && (
              <select
                defaultValue=""
                disabled={guardando}
                onChange={(e) => {
                  if (e.target.value) void accion({ accion: 'copiar', origen: e.target.value })
                  e.target.value = ''
                }}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                aria-label="Copiar del anterior"
              >
                <option value="">Copiar secuencia de…</option>
                {otros.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            )}
            <Copy className="hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden />
          </div>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold text-foreground">Añadir pieza</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-6">
              <select
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                <option value="publicacion">Publicación</option>
                <option value="descargable">Descargable</option>
              </select>
              <select
                value={form.canal}
                onChange={(e) => setForm({ ...form, canal: e.target.value })}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              >
                {CANALES.map((c) => (
                  <option key={c} value={c}>
                    {ETIQUETA_CANAL[c]}
                  </option>
                ))}
              </select>
              <input
                type="number"
                placeholder="Día (-3 = 3 antes)"
                disabled={form.tipo === 'descargable'}
                value={form.dia}
                onChange={(e) => setForm({ ...form, dia: e.target.value })}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
              />
              <input
                type="time"
                value={form.hora}
                onChange={(e) => setForm({ ...form, hora: e.target.value })}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
              />
              <input
                placeholder="Título"
                value={form.titulo}
                onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm sm:col-span-2"
              />
              <textarea
                placeholder="Copy o guion"
                rows={3}
                value={form.texto}
                onChange={(e) => setForm({ ...form, texto: e.target.value })}
                className="rounded-md border border-border bg-background px-2 py-1.5 text-sm sm:col-span-4"
              />
              <div className="flex flex-col gap-2 sm:col-span-2">
                <input
                  placeholder="Enlace (Drive, Canva…)"
                  value={form.enlace}
                  onChange={(e) => setForm({ ...form, enlace: e.target.value })}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
                <button
                  disabled={!form.titulo.trim() || guardando}
                  onClick={() => void crear()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" /> Añadir
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Solo admin o director pueden guardar cambios. El día es relativo al evento (0 = día del evento).
            </p>
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold text-foreground">Calendario de publicaciones ({publicaciones.length})</h2>
            {publicaciones.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Sin publicaciones para este lanzamiento.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {publicaciones.map((p) => (
                  <Fila key={p.id} p={p} fechaEvento={lanz?.fecha} guardando={guardando} accion={accion} />
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold text-foreground">Descargables ({descargables.length})</h2>
            {descargables.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Sin descargables.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {descargables.map((p) => (
                  <Fila key={p.id} p={p} fechaEvento={lanz?.fecha} guardando={guardando} accion={accion} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Fila({
  p,
  fechaEvento,
  guardando,
  accion,
}: {
  p: PiezaContenido
  fechaEvento?: string
  guardando: boolean
  accion: (b: Record<string, unknown>) => Promise<boolean>
}) {
  const fecha = fechaEvento ? fechaDePieza(fechaEvento, p.dia) : null
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {p.titulo}
          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
            {ETIQUETA_CANAL[p.canal] ?? p.canal}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          {p.dia != null ? `Día ${p.dia > 0 ? '+' : ''}${p.dia}${fecha ? ` · ${fecha}` : ''}` : 'Sin día'}
          {p.hora ? ` · ${p.hora}` : ''}
        </p>
        {p.texto && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{p.texto}</p>}
        {p.enlace && (
          <a href={p.enlace} target="_blank" rel="noreferrer" className="text-xs text-brand-600 underline">
            Abrir enlace
          </a>
        )}
      </div>
      <div className="flex items-center gap-2">
        <select
          value={p.estado}
          disabled={guardando}
          onChange={(e) => void accion({ accion: 'editar', id: p.id, datos: { estado: e.target.value } })}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
          aria-label="Estado"
        >
          {ESTADOS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          disabled={guardando}
          onClick={() => {
            if (confirm('¿Borrar esta pieza?')) void accion({ accion: 'borrar', id: p.id })
          }}
          aria-label="Borrar pieza"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </li>
  )
}
