'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Check, ChevronRight, GraduationCap, Pencil, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { ROLE_LABELS, type AppRole } from '@/lib/auth/permissions'
import { ordenarLecciones, resumenProgreso, siguientePendiente } from '@/lib/formacion/progreso'
import { parsearVideo } from '@/lib/formacion/video'
import { SopsLista, type Sop } from '@/components/formacion/SopsLista'
import { useTenant } from '@/lib/tenant-context'

type Curso = {
  id: string
  title: string
  description: string | null
  position: number
  audience_roles: string[] | null
}
type Leccion = {
  id: string
  course_id: string
  title: string
  description: string | null
  video_url: string | null
  video_provider: string | null
  position: number
}
type Datos = { cursos: Curso[]; lecciones: Leccion[]; recursos: Sop[]; hechas: string[]; puedeEditar: boolean }

type Editor =
  | { tipo: 'curso'; id?: string; title: string; description: string; audience: string[] }
  | {
      tipo: 'leccion'
      id?: string
      courseId: string
      title: string
      description: string
      videoUrl: string
    }

function FormacionInner() {
  const tenant = useTenant()
  const params = useSearchParams()
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<string | null>(params.get('leccion'))
  const [editor, setEditor] = useState<Editor | null>(null)
  // Modo gestión (solo administradores): ve y edita TODOS los cursos. Por defecto cada persona ve lo de su rol.
  const [gestionar, setGestionar] = useState(params.get('gestionar') === '1')
  const [guardando, setGuardando] = useState(false)
  const cargado = useRef(false)

  const base = `/api/${tenant}/evergreen/formacion`

  const cargar = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(gestionar ? `${base}?gestionar=1` : base, { signal, cache: 'no-store' })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Error')
        setDatos(json as Datos)
        cargado.current = true
        setError(null)
      } catch (e) {
        if ((e as Error).name === 'AbortError') return
        // Con datos ya en pantalla, un fallo de recarga no debe sustituir toda la página por un error.
        if (cargado.current) toast.error('No se pudo actualizar la formación', { description: (e as Error).message })
        else setError((e as Error).message)
      }
    },
    [base, gestionar]
  )

  // Un enlace interno a /formacion?leccion=<id> con la página ya abierta reutiliza el componente: se sigue la URL.
  const leccionDeUrl = params.get('leccion')
  useEffect(() => {
    if (leccionDeUrl) setSeleccion(leccionDeUrl)
  }, [leccionDeUrl])

  useEffect(() => {
    const ac = new AbortController()
    void cargar(ac.signal)
    return () => ac.abort()
  }, [cargar])

  // Lecciones en el orden en que se ven (el mismo que usa la tarjeta del dashboard).
  const ordenadas = useMemo(() => (datos ? ordenarLecciones(datos.cursos, datos.lecciones) : []), [datos])

  const sopsDe = useCallback(
    (leccionId: string) => (datos?.recursos ?? []).filter((r) => r.lesson_id === leccionId),
    [datos]
  )
  const hechas = useMemo(() => new Set(datos?.hechas ?? []), [datos])
  const resumen = useMemo(() => resumenProgreso(ordenadas, hechas), [ordenadas, hechas])
  const actual =
    ordenadas.find((l) => l.id === seleccion) ?? siguientePendiente(ordenadas, hechas) ?? ordenadas[0] ?? null
  const indiceActual = actual ? ordenadas.findIndex((l) => l.id === actual.id) : -1
  const siguiente = indiceActual >= 0 ? (ordenadas[indiceActual + 1] ?? null) : null

  const llamar = async (cuerpo: Record<string, unknown>, ok?: string) => {
    setGuardando(true)
    try {
      const res = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'No se pudo guardar')
      if (ok) toast.success(ok)
      await cargar()
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    } finally {
      setGuardando(false)
    }
  }

  const marcar = async (leccion: Leccion, hecho: boolean): Promise<boolean> => {
    // Optimista: la marca se ve al instante y se revierte si el servidor falla.
    setDatos((d) =>
      d
        ? { ...d, hechas: hecho ? [...new Set([...d.hechas, leccion.id])] : d.hechas.filter((x) => x !== leccion.id) }
        : d
    )
    try {
      const res = await fetch(`${base}/progreso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessonId: leccion.id, hecho }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Error')
      return true
    } catch (e) {
      toast.error('No se pudo guardar tu progreso', { description: (e as Error).message })
      await cargar()
      return false
    }
  }

  const guardarEditor = async () => {
    if (!editor) return
    const cuerpo =
      editor.tipo === 'curso'
        ? {
            action: editor.id ? 'editar_curso' : 'crear_curso',
            id: editor.id,
            title: editor.title,
            description: editor.description,
            audienceRoles: editor.audience,
          }
        : {
            action: editor.id ? 'editar_leccion' : 'crear_leccion',
            id: editor.id,
            courseId: editor.courseId,
            title: editor.title,
            description: editor.description,
            videoUrl: editor.videoUrl,
          }
    if (await llamar(cuerpo, 'Guardado')) setEditor(null)
  }

  if (error)
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400" role="alert">
        No se pudo cargar la formación: {error}
      </div>
    )
  if (!datos) return <Skeleton className="h-96 w-full" />

  const vacio = datos.cursos.length === 0
  // Los controles de edición solo aparecen en modo gestión: en la vista normal un administrador es un alumno más.
  const editando = datos.puedeEditar && gestionar

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Formación</h1>
          <p className="text-sm text-muted-foreground">
            {resumen.total > 0
              ? `${resumen.hechas} de ${resumen.total} lecciones completadas (${resumen.porcentaje}%)`
              : 'Aquí aprenderás paso a paso, con vídeos cortos.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {datos.puedeEditar && (
            <Button variant="outline" onClick={() => setGestionar((g) => !g)}>
              {gestionar ? 'Volver a mi formación' : 'Gestionar formación del equipo'}
            </Button>
          )}
          {editando && (
            <>
              {vacio && (
                <Button
                  variant="outline"
                  disabled={guardando}
                  onClick={() => llamar({ action: 'curso_estandar' }, 'Curso estándar creado')}
                >
                  <GraduationCap className="mr-2 h-4 w-4" /> Crear curso estándar
                </Button>
              )}
              <Button onClick={() => setEditor({ tipo: 'curso', title: '', description: '', audience: [] })}>
                <Plus className="mr-2 h-4 w-4" /> Nuevo curso
              </Button>
            </>
          )}
        </div>
      </header>

      {resumen.total > 0 && (
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={resumen.porcentaje}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progreso de formación"
        >
          <div
            className="h-full bg-[hsl(var(--brand-500))] transition-all"
            style={{ width: `${resumen.porcentaje}%` }}
          />
        </div>
      )}

      {vacio ? (
        <div className="dashboard-card p-8 text-center">
          <p className="font-medium text-foreground">Todavía no hay formación</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {editando
              ? 'Crea el curso estándar para empezar con los pasos básicos, o añade tu propio curso.'
              : datos.puedeEditar
                ? 'No hay formación para tu rol. Usa «Gestionar formación del equipo» para ver y crear los cursos de cada rol.'
                : 'Cuando tu equipo añada las lecciones, las verás aquí.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <nav aria-label="Lecciones" className="space-y-4">
            {datos.cursos.map((curso) => {
              const lecs = ordenadas.filter((l) => l.course_id === curso.id)
              return (
                <section key={curso.id} className="dashboard-card p-3">
                  <div className="flex items-start justify-between gap-2 px-1 pb-2">
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">{curso.title}</h2>
                      {curso.description && <p className="text-xs text-muted-foreground">{curso.description}</p>}
                      {editando && (
                        <p className="mt-0.5 text-2xs text-muted-foreground">
                          Para:{' '}
                          {curso.audience_roles?.length
                            ? curso.audience_roles.map((r) => ROLE_LABELS[r as AppRole] ?? r).join(', ')
                            : 'todo el equipo'}
                        </p>
                      )}
                    </div>
                    {editando && (
                      <div className="flex shrink-0 gap-1">
                        <button
                          aria-label="Editar curso"
                          className="p-1 text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setEditor({
                              tipo: 'curso',
                              id: curso.id,
                              title: curso.title,
                              description: curso.description ?? '',
                              audience: curso.audience_roles ?? [],
                            })
                          }
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          aria-label="Borrar curso"
                          className="p-1 text-muted-foreground hover:text-red-400"
                          onClick={() => {
                            if (window.confirm(`¿Borrar el curso «${curso.title}» y todas sus lecciones?`))
                              void llamar({ action: 'borrar_curso', id: curso.id }, 'Curso borrado')
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <ol className="space-y-1">
                    {lecs.map((l, i) => (
                      <li key={l.id}>
                        <button
                          onClick={() => setSeleccion(l.id)}
                          aria-current={actual?.id === l.id ? 'true' : undefined}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted ${actual?.id === l.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground'}`}
                        >
                          <span
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-3xs ${hechas.has(l.id) ? 'border-transparent bg-[hsl(var(--brand-500))] text-white' : 'border-border'}`}
                          >
                            {hechas.has(l.id) ? <Check className="h-3 w-3" aria-label="Hecha" /> : i + 1}
                          </span>
                          <span className="line-clamp-2">{l.title}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                  {editando && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 w-full justify-start"
                      onClick={() =>
                        setEditor({
                          tipo: 'leccion',
                          courseId: curso.id,
                          title: '',
                          description: '',
                          videoUrl: '',
                        })
                      }
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Añadir lección
                    </Button>
                  )}
                </section>
              )
            })}
          </nav>

          <article className="dashboard-card space-y-4 p-4 sm:p-6">
            {!actual ? (
              <p className="text-sm text-muted-foreground">Este curso aún no tiene lecciones.</p>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-display text-xl font-semibold text-foreground">{actual.title}</h2>
                  {editando && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        aria-label="Editar lección"
                        className="p-1 text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          setEditor({
                            tipo: 'leccion',
                            id: actual.id,
                            courseId: actual.course_id,
                            title: actual.title,
                            description: actual.description ?? '',
                            videoUrl: actual.video_url ?? '',
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        aria-label="Borrar lección"
                        className="p-1 text-muted-foreground hover:text-red-400"
                        onClick={() => {
                          if (window.confirm(`¿Borrar la lección «${actual.title}»?`))
                            void llamar({ action: 'borrar_leccion', id: actual.id }, 'Lección borrada')
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                {actual.video_url && parsearVideo(actual.video_url) ? (
                  <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
                    <iframe
                      key={actual.id}
                      src={parsearVideo(actual.video_url)!.embedUrl}
                      title={actual.title}
                      className="h-full w-full"
                      loading="lazy"
                      allow="autoplay; fullscreen; picture-in-picture; clipboard-write"
                      allowFullScreen
                      referrerPolicy="strict-origin-when-cross-origin"
                    />
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    El vídeo de esta lección todavía no está disponible.
                  </div>
                )}

                {actual.description && (
                  <p className="whitespace-pre-line text-sm text-foreground/90">{actual.description}</p>
                )}

                <SopsLista
                  sops={sopsDe(actual.id)}
                  puedeEditar={editando}
                  onAdd={(titulo, url) =>
                    llamar({ action: 'crear_sop', lessonId: actual.id, title: titulo, url }, 'SOP añadido')
                  }
                  onDelete={async (id) => {
                    await llamar({ action: 'borrar_sop', id }, 'SOP quitado')
                  }}
                />

                <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                  <Button
                    variant={hechas.has(actual.id) ? 'outline' : 'default'}
                    onClick={() => marcar(actual, !hechas.has(actual.id))}
                  >
                    <Check className="mr-2 h-4 w-4" />{' '}
                    {hechas.has(actual.id) ? 'Hecha · desmarcar' : 'Marcar como hecha'}
                  </Button>
                  {siguiente && (
                    <Button
                      variant="ghost"
                      onClick={async () => {
                        // Solo avanza si la lección quedó guardada como hecha: no se salta pasos sin querer.
                        if (!hechas.has(actual.id) && !(await marcar(actual, true))) return
                        setSeleccion(siguiente.id)
                      }}
                    >
                      Siguiente: {siguiente.title} <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  )}
                </div>
              </>
            )}
          </article>
        </div>
      )}

      <Dialog open={!!editor} onOpenChange={(o) => !o && setEditor(null)}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto bg-card text-foreground">
          <DialogHeader>
            <DialogTitle>
              {editor?.tipo === 'curso'
                ? editor.id
                  ? 'Editar curso'
                  : 'Nuevo curso'
                : editor?.id
                  ? 'Editar lección'
                  : 'Nueva lección'}
            </DialogTitle>
          </DialogHeader>
          {editor && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Título *</Label>
                <Input
                  value={editor.title}
                  maxLength={160}
                  onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Descripción</Label>
                <Textarea
                  value={editor.description}
                  rows={4}
                  onChange={(e) => setEditor({ ...editor, description: e.target.value })}
                />
              </div>
              {editor.tipo === 'curso' && (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">¿Para quién es?</legend>
                  <p className="text-xs text-muted-foreground">
                    Sin marcar nada lo ve todo el equipo. Marca los perfiles que deben verlo (p. ej. Closer, Media
                    buyer).
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(ROLE_LABELS) as AppRole[]).map((rol) => (
                      <label key={rol} className="flex cursor-pointer items-center gap-2 text-sm">
                        <Checkbox
                          checked={editor.audience.includes(rol)}
                          onCheckedChange={(v) =>
                            setEditor({
                              ...editor,
                              audience: v ? [...editor.audience, rol] : editor.audience.filter((r) => r !== rol),
                            })
                          }
                        />
                        {ROLE_LABELS[rol]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              {editor.tipo === 'leccion' && (
                <>
                  <div className="space-y-2">
                    <Label>Enlace del vídeo</Label>
                    <Input
                      value={editor.videoUrl}
                      placeholder="https://www.loom.com/share/…"
                      onChange={(e) => setEditor({ ...editor, videoUrl: e.target.value })}
                    />
                    <p className="text-xs text-muted-foreground">
                      YouTube, Loom, Wistia, Vimeo o Bunny. El vídeo no se sube aquí: se enlaza.
                    </p>
                  </div>
                </>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditor(null)}>
                  Cancelar
                </Button>
                <Button disabled={guardando || !editor.title.trim()} onClick={guardarEditor}>
                  Guardar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function FormacionPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <FormacionInner />
    </Suspense>
  )
}
