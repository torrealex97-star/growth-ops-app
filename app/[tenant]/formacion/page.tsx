'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { Check, ChevronRight, ExternalLink, GraduationCap, Pencil, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { resumenProgreso, siguientePendiente } from '@/lib/formacion/progreso'
import { useTenant } from '@/lib/tenant-context'

type Curso = { id: string; title: string; description: string | null; position: number }
type Leccion = {
  id: string
  course_id: string
  title: string
  description: string | null
  video_url: string | null
  video_provider: string | null
  resource_url: string | null
  resource_label: string | null
  position: number
}
type Datos = { cursos: Curso[]; lecciones: Leccion[]; hechas: string[]; puedeEditar: boolean }

type Editor =
  | { tipo: 'curso'; id?: string; title: string; description: string }
  | {
      tipo: 'leccion'
      id?: string
      courseId: string
      title: string
      description: string
      videoUrl: string
      resourceUrl: string
      resourceLabel: string
    }

function FormacionInner() {
  const tenant = useTenant()
  const params = useSearchParams()
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seleccion, setSeleccion] = useState<string | null>(params.get('leccion'))
  const [editor, setEditor] = useState<Editor | null>(null)
  const [guardando, setGuardando] = useState(false)

  const base = `/api/${tenant}/evergreen/formacion`

  const cargar = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const res = await fetch(base, { signal, cache: 'no-store' })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Error')
        setDatos(json as Datos)
        setError(null)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message)
      }
    },
    [base]
  )

  useEffect(() => {
    const ac = new AbortController()
    void cargar(ac.signal)
    return () => ac.abort()
  }, [cargar])

  // Lecciones en el orden en que se ven: por curso y posición.
  const ordenadas = useMemo(() => {
    if (!datos) return []
    const ordenCurso = new Map(datos.cursos.map((c, i) => [c.id, i]))
    return [...datos.lecciones].sort(
      (a, b) => (ordenCurso.get(a.course_id) ?? 0) - (ordenCurso.get(b.course_id) ?? 0) || a.position - b.position
    )
  }, [datos])

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

  const marcar = async (leccion: Leccion, hecho: boolean) => {
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
    } catch (e) {
      toast.error('No se pudo guardar tu progreso', { description: (e as Error).message })
      await cargar()
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
          }
        : {
            action: editor.id ? 'editar_leccion' : 'crear_leccion',
            id: editor.id,
            courseId: editor.courseId,
            title: editor.title,
            description: editor.description,
            videoUrl: editor.videoUrl,
            resourceUrl: editor.resourceUrl,
            resourceLabel: editor.resourceLabel,
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
        {datos.puedeEditar && (
          <div className="flex gap-2">
            {vacio && (
              <Button
                variant="outline"
                disabled={guardando}
                onClick={() => llamar({ action: 'curso_estandar' }, 'Curso estándar creado')}
              >
                <GraduationCap className="mr-2 h-4 w-4" /> Crear curso estándar
              </Button>
            )}
            <Button onClick={() => setEditor({ tipo: 'curso', title: '', description: '' })}>
              <Plus className="mr-2 h-4 w-4" /> Nuevo curso
            </Button>
          </div>
        )}
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
            {datos.puedeEditar
              ? 'Crea el curso estándar para empezar con los pasos básicos, o añade tu propio curso.'
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
                    </div>
                    {datos.puedeEditar && (
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
                  {datos.puedeEditar && (
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
                          resourceUrl: '',
                          resourceLabel: '',
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
                  {datos.puedeEditar && (
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
                            resourceUrl: actual.resource_url ?? '',
                            resourceLabel: actual.resource_label ?? '',
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

                {actual.video_url ? (
                  <div className="aspect-video w-full overflow-hidden rounded-lg border border-border bg-black">
                    <iframe
                      key={actual.id}
                      src={actual.video_url}
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

                {actual.resource_url && (
                  <a
                    href={actual.resource_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    <ExternalLink className="h-4 w-4" /> {actual.resource_label || 'Abrir el material de apoyo'}
                  </a>
                )}

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
                        if (!hechas.has(actual.id)) await marcar(actual, true)
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
                  <div className="space-y-2">
                    <Label>Material de apoyo (opcional)</Label>
                    <Input
                      value={editor.resourceUrl}
                      placeholder="https://docs.google.com/…"
                      onChange={(e) => setEditor({ ...editor, resourceUrl: e.target.value })}
                    />
                    <Input
                      value={editor.resourceLabel}
                      maxLength={80}
                      placeholder="Nombre del botón, p. ej. «Abrir el manual»"
                      onChange={(e) => setEditor({ ...editor, resourceLabel: e.target.value })}
                    />
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
