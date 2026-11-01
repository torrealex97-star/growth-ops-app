'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, Loader2, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { CANALES, ESTADOS, fechaDePieza, type PiezaContenido } from '@/lib/launch/contenido'
import { CHECKLIST, progresoChecklist } from '@/lib/launch/plantilla'

// CONTENIDO DEL LANZAMIENTO: calendario de la nutrición multicanal (email, WhatsApp, stories...) y
// descargables. Las piezas se fechan respecto al evento, así que «Copiar secuencia» trae la
// secuencia ya estandarizada. Solo admin/director editan; el resto lo ve sin formulario.

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

const ESTILO_ESTADO: Record<string, string> = {
  pendiente: 'bg-muted text-muted-foreground',
  listo: 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200',
  publicado: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

const VACIO = { tipo: 'publicacion', canal: 'whatsapp', dia: '', hora: '', titulo: '', texto: '', enlace: '' }
const CAMPO = 'rounded-md border border-border bg-background px-2 py-1.5 text-sm'

export default function ContenidoLanzamientoPage() {
  const tenant = useTenant()
  const [cal, setCal] = useState<Lanzamiento[]>([])
  const [launchId, setLaunchId] = useState('')
  const [piezas, setPiezas] = useState<PiezaContenido[]>([])
  const [puedeEditar, setPuedeEditar] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [cargandoPiezas, setCargandoPiezas] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState(VACIO)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [marcados, setMarcados] = useState<string[]>([])
  const [guion, setGuion] = useState('')
  const [guionGuardado, setGuionGuardado] = useState('')
  const abortPiezas = useRef<AbortController | null>(null)

  const base = `/api/${tenant}/evergreen/lanzamiento`

  // Solo la última petición manda: cambiar de lanzamiento rápido no pinta datos del anterior.
  const cargarPiezas = useCallback(
    async (id: string) => {
      abortPiezas.current?.abort()
      const ac = new AbortController()
      abortPiezas.current = ac
      setCargandoPiezas(true)
      setError(null)
      try {
        const r = await fetch(`${base}/contenido?launch=${id}`, { signal: ac.signal })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || 'No se pudo leer el contenido')
        setPiezas(j.piezas as PiezaContenido[])
        setPuedeEditar(Boolean(j.puedeEditar))
        setGuion((j.guion as string | null) ?? '')
        setGuionGuardado((j.guion as string | null) ?? '')
        const rc = await fetch(`${base}/checklist?launch=${id}`, { signal: ac.signal })
        const jc = await rc.json()
        if (rc.ok) setMarcados(jc.marcados as string[])
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : 'Error de conexión')
      } finally {
        if (abortPiezas.current === ac) setCargandoPiezas(false)
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
        if (inicial) await cargarPiezas(inicial)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : 'Error de conexión')
      } finally {
        setCargando(false)
      }
    })()
    return () => {
      ac.abort()
      abortPiezas.current?.abort()
    }
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

  const datosDelForm = () => ({
    tipo: form.tipo,
    canal: form.canal,
    dia: form.tipo === 'descargable' || form.dia === '' ? null : Number(form.dia),
    hora: form.hora || null,
    titulo: form.titulo,
    texto: form.texto || null,
    enlace: form.enlace || null,
  })

  const guardar = async () => {
    const ok = editandoId
      ? await accion({ accion: 'editar', id: editandoId, datos: datosDelForm() })
      : await accion({ accion: 'crear', datos: datosDelForm() })
    if (ok) {
      setForm(VACIO)
      setEditandoId(null)
    }
  }

  const editar = (p: PiezaContenido) => {
    setEditandoId(p.id)
    setForm({
      tipo: p.tipo,
      canal: p.canal,
      dia: p.dia == null ? '' : String(p.dia),
      hora: p.hora ?? '',
      titulo: p.titulo,
      texto: p.texto ?? '',
      enlace: p.enlace ?? '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cancelarEdicion = () => {
    setEditandoId(null)
    setForm(VACIO)
  }

  const copiar = (origen: string) => {
    if (
      piezas.length > 0 &&
      !confirm(`Este lanzamiento ya tiene ${piezas.length} piezas. Copiar añadirá la secuencia encima. ¿Continuar?`)
    )
      return
    void accion({ accion: 'copiar', origen })
  }

  const aplicarPlantillaEstandar = async () => {
    if (
      piezas.length > 0 &&
      !confirm(`Este lanzamiento ya tiene ${piezas.length} piezas. La plantilla se añadirá encima. ¿Continuar?`)
    )
      return
    await accion({ accion: 'plantilla' })
  }

  const marcar = async (key: string, hecho: boolean) => {
    const antes = marcados
    setMarcados(hecho ? [...marcados, key] : marcados.filter((k) => k !== key))
    try {
      const r = await fetch(`${base}/checklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ launchId, key, hecho }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'No se pudo guardar')
    } catch (e) {
      setMarcados(antes)
      setError(e instanceof Error ? e.message : 'Error de conexión')
    }
  }

  const progreso = progresoChecklist(marcados)
  const lanz = cal.find((l) => l.id === launchId)
  const publicaciones = piezas.filter((p) => p.tipo === 'publicacion')
  const descargables = piezas.filter((p) => p.tipo === 'descargable')
  const otros = cal.filter((l) => l.id !== launchId)
  const publicadas = piezas.filter((p) => p.estado === 'publicado').length

  // Agrupadas por día (el orden ya viene de la API): una cabecera por día, no una fila repetida.
  const porDia = new Map<string, PiezaContenido[]>()
  for (const p of publicaciones) {
    const k = p.dia == null ? 'sin' : String(p.dia)
    porDia.set(k, [...(porDia.get(k) ?? []), p])
  }

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
        <p
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {!cargando && cal.length === 0 && !error && (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          Aún no hay lanzamientos. Programa uno en el panel de Lanzamientos para planificar su contenido.
        </p>
      )}

      {!cargando && cal.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Lanzamiento"
              value={launchId}
              onChange={(e) => {
                setLaunchId(e.target.value)
                cancelarEdicion()
                void cargarPiezas(e.target.value)
              }}
              className={CAMPO}
            >
              {cal.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label} · {l.fecha}
                </option>
              ))}
            </select>
            {puedeEditar && otros.length > 0 && (
              <select
                aria-label="Copiar secuencia de otro lanzamiento"
                defaultValue=""
                disabled={guardando}
                onChange={(e) => {
                  if (e.target.value) copiar(e.target.value)
                  e.target.value = ''
                }}
                className={CAMPO}
              >
                <option value="">Copiar secuencia de…</option>
                {otros.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            )}
            {puedeEditar && (
              <button
                disabled={guardando}
                onClick={() => void aplicarPlantillaEstandar()}
                className={`${CAMPO} hover:bg-muted disabled:opacity-50`}
              >
                Aplicar plantilla estándar
              </button>
            )}
            {cargandoPiezas && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
            {piezas.length > 0 && (
              <span className="ml-auto text-sm tabular-nums text-muted-foreground">
                {publicadas} de {piezas.length} publicadas
              </span>
            )}
          </div>

          <section className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-foreground">Checklist del lanzamiento</h2>
              <span className="text-sm tabular-nums text-muted-foreground">
                {progreso.hecho} de {progreso.total}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className="h-full bg-brand-600 transition-[width] duration-300 ease-out motion-reduce:transition-none"
                style={{ width: `${progreso.total ? (progreso.hecho / progreso.total) * 100 : 0}%` }}
              />
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {CHECKLIST.map((f) => {
                const p = progreso.porFase.find((x) => x.id === f.id)
                return (
                  <fieldset key={f.id}>
                    <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {f.titulo} · {p?.hecho}/{p?.total}
                    </legend>
                    <ul className="mt-1 space-y-1">
                      {f.items.map((it) => (
                        <li key={it.key}>
                          <label className="flex items-start gap-2 text-sm text-foreground">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={marcados.includes(it.key)}
                              disabled={!puedeEditar}
                              onChange={(e) => void marcar(it.key, e.target.checked)}
                            />
                            <span>{it.texto}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                )
              })}
            </div>
          </section>

          {puedeEditar && (
            <section className="rounded-lg border border-border bg-card p-4">
              <h2 className="font-semibold text-foreground">Guion del webinar</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Es la fuente de todo el contenido: con él, cada pieza del calendario se puede generar con IA repitiendo
                la misma creencia que se vende en el directo.
              </p>
              <textarea
                aria-label="Guion del webinar"
                rows={6}
                maxLength={60000}
                value={guion}
                onChange={(e) => setGuion(e.target.value)}
                placeholder="Pega aquí el guion completo del webinar…"
                className={`${CAMPO} mt-3 w-full`}
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {guion.length.toLocaleString('es-ES')} / 60.000 caracteres
                </span>
                <button
                  disabled={guardando || guion === guionGuardado}
                  onClick={async () => {
                    if (await accion({ accion: 'guion', guion })) setGuionGuardado(guion)
                  }}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                >
                  Guardar guion
                </button>
              </div>
            </section>
          )}

          {puedeEditar ? (
            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-foreground">{editandoId ? 'Editar pieza' : 'Añadir pieza'}</h2>
                {editandoId && (
                  <button
                    onClick={cancelarEdicion}
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" /> Cancelar
                  </button>
                )}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-6">
                <select
                  aria-label="Tipo"
                  value={form.tipo}
                  onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                  className={CAMPO}
                >
                  <option value="publicacion">Publicación</option>
                  <option value="descargable">Descargable</option>
                </select>
                <select
                  aria-label="Canal"
                  value={form.canal}
                  onChange={(e) => setForm({ ...form, canal: e.target.value })}
                  className={CAMPO}
                >
                  {CANALES.map((c) => (
                    <option key={c} value={c}>
                      {ETIQUETA_CANAL[c]}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  aria-label="Día respecto al evento"
                  placeholder="Día (-3 = 3 antes)"
                  disabled={form.tipo === 'descargable'}
                  value={form.dia}
                  onChange={(e) => setForm({ ...form, dia: e.target.value })}
                  className={`${CAMPO} disabled:opacity-50`}
                />
                <input
                  type="time"
                  aria-label="Hora"
                  value={form.hora}
                  onChange={(e) => setForm({ ...form, hora: e.target.value })}
                  className={CAMPO}
                />
                <input
                  aria-label="Título"
                  placeholder="Título"
                  maxLength={200}
                  value={form.titulo}
                  onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  className={`${CAMPO} sm:col-span-2`}
                />
                <textarea
                  aria-label="Copy o guion"
                  placeholder="Copy o guion"
                  rows={3}
                  value={form.texto}
                  onChange={(e) => setForm({ ...form, texto: e.target.value })}
                  className={`${CAMPO} sm:col-span-4`}
                />
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <input
                    type="url"
                    aria-label="Enlace"
                    placeholder="Enlace (Drive, Canva…)"
                    value={form.enlace}
                    onChange={(e) => setForm({ ...form, enlace: e.target.value })}
                    className={CAMPO}
                  />
                  <button
                    disabled={!form.titulo.trim() || guardando}
                    onClick={() => void guardar()}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    {editandoId ? 'Guardar cambios' : 'Añadir'}
                  </button>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                El día es relativo al evento: 0 = día del evento, -3 = tres días antes.
              </p>
            </section>
          ) : (
            <p className="text-xs text-muted-foreground">
              Solo admin o director pueden modificar el contenido. Tú puedes consultarlo.
            </p>
          )}

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold text-foreground">Calendario de publicaciones ({publicaciones.length})</h2>
            {publicaciones.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Sin publicaciones para este lanzamiento.
                {puedeEditar && otros.length > 0 ? ' Puedes copiar la secuencia de uno anterior.' : ''}
              </p>
            ) : (
              <div className="mt-3 space-y-4">
                {[...porDia.entries()].map(([k, lista]) => {
                  const dia = k === 'sin' ? null : Number(k)
                  const fecha = lanz && dia != null ? fechaDePieza(lanz.fecha, dia) : null
                  return (
                    <div key={k}>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {dia == null ? 'Sin día' : dia === 0 ? 'Día del evento' : `Día ${dia > 0 ? '+' : ''}${dia}`}
                        {fecha ? ` · ${fecha}` : ''}
                      </h3>
                      <ul className="mt-1 divide-y divide-border">
                        {lista.map((p) => (
                          <Fila
                            key={p.id}
                            p={p}
                            puedeEditar={puedeEditar}
                            guardando={guardando}
                            accion={accion}
                            editar={editar}
                            tieneGuion={Boolean(guionGuardado.trim())}
                            base={base}
                          />
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-semibold text-foreground">Descargables ({descargables.length})</h2>
            {descargables.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">Sin descargables.</p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {descargables.map((p) => (
                  <Fila
                    key={p.id}
                    p={p}
                    puedeEditar={puedeEditar}
                    guardando={guardando}
                    accion={accion}
                    editar={editar}
                    tieneGuion={Boolean(guionGuardado.trim())}
                    base={base}
                  />
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
  puedeEditar,
  guardando,
  accion,
  editar,
  tieneGuion,
  base,
}: {
  p: PiezaContenido
  puedeEditar: boolean
  guardando: boolean
  accion: (b: Record<string, unknown>) => Promise<boolean>
  editar: (p: PiezaContenido) => void
  tieneGuion: boolean
  base: string
}) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          {p.titulo}
          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
            {ETIQUETA_CANAL[p.canal] ?? p.canal}
          </span>
          {p.hora && <span className="ml-2 text-xs font-normal text-muted-foreground">{p.hora}</span>}
        </p>
        {p.texto && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{p.texto}</p>}
        {p.enlace && (
          <a
            href={p.enlace}
            target="_blank"
            rel="noreferrer noopener"
            className="text-xs text-brand-600 underline underline-offset-2"
          >
            Abrir enlace
          </a>
        )}
        {puedeEditar && (
          <GenerarConIA
            pieza={p}
            tieneGuion={tieneGuion}
            base={base}
            onUsar={(texto) => accion({ accion: 'editar', id: p.id, datos: { texto } })}
          />
        )}
      </div>
      <div className="flex items-center gap-1">
        {puedeEditar ? (
          <>
            <select
              value={p.estado}
              disabled={guardando}
              onChange={(e) => void accion({ accion: 'editar', id: p.id, datos: { estado: e.target.value } })}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              aria-label={`Estado de ${p.titulo}`}
            >
              {ESTADOS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button
              disabled={guardando}
              onClick={() => editar(p)}
              aria-label={`Editar ${p.titulo}`}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              disabled={guardando}
              onClick={() => {
                if (confirm(`¿Borrar «${p.titulo}»?`)) void accion({ accion: 'borrar', id: p.id })
              }}
              aria-label={`Borrar ${p.titulo}`}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        ) : (
          <span className={`rounded px-2 py-0.5 text-xs ${ESTILO_ESTADO[p.estado]}`}>{p.estado}</span>
        )}
      </div>
    </li>
  )
}

// Sugerencia de texto para una pieza a partir del guion del webinar. No se guarda sola: la persona
// la revisa y decide si la usa, la regenera o la descarta.
function GenerarConIA({
  pieza,
  tieneGuion,
  base,
  onUsar,
}: {
  pieza: PiezaContenido
  tieneGuion: boolean
  base: string
  onUsar: (texto: string) => Promise<boolean>
}) {
  const [sugerencia, setSugerencia] = useState<{ texto: string; motor: string } | null>(null)
  const [generando, setGenerando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const generar = async () => {
    setGenerando(true)
    setError(null)
    try {
      const r = await fetch(`${base}/contenido`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'generar', id: pieza.id }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'No se pudo generar')
      setSugerencia({ texto: j.texto as string, motor: j.motor as string })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error de conexión')
    } finally {
      setGenerando(false)
    }
  }

  return (
    <div className="mt-2">
      <button
        disabled={generando || !tieneGuion}
        onClick={() => void generar()}
        title={tieneGuion ? undefined : 'Guarda antes el guion del webinar'}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50"
      >
        {generando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {sugerencia ? 'Regenerar con IA' : 'Generar con IA'}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {sugerencia && (
        <div className="mt-2 rounded-md border border-border bg-muted/40 p-3">
          <p className="whitespace-pre-wrap text-sm text-foreground">{sugerencia.texto}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Sugerencia de {sugerencia.motor}. Revísala antes de publicar.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={async () => {
                if (await onUsar(sugerencia.texto)) setSugerencia(null)
              }}
              className="rounded-md bg-brand-600 px-3 py-1 text-xs font-medium text-white hover:bg-brand-700"
            >
              Usar este texto
            </button>
            <button
              onClick={() => setSugerencia(null)}
              className="rounded-md border border-border px-3 py-1 text-xs hover:bg-muted"
            >
              Descartar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
