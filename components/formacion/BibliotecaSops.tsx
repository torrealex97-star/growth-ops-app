'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, FileText } from 'lucide-react'

import { Skeleton } from '@/components/ui/skeleton'
import { SearchBox, normalizeText } from '@/components/ui/search-box'
import { ordenarLecciones } from '@/lib/formacion/progreso'
import { useTenant } from '@/lib/tenant-context'
import type { Sop } from '@/components/formacion/SopsLista'

type Curso = { id: string; title: string }
type Leccion = { id: string; course_id: string; title: string; position: number }
type Datos = { cursos: Curso[]; lecciones: Leccion[]; recursos: Sop[] }

/**
 * Pestaña «SOPs» de Recursos › Biblioteca: los mismos documentos que cuelgan de las lecciones de Formación, en una sola
 * lista para encontrarlos sin abrir cada vídeo. NO guarda nada propio: se edita en Formación, así que no hay dos sitios
 * que mantener. Cada persona ve solo los cursos de su rol (lo decide la API).
 */
export function BibliotecaSops() {
  const tenant = useTenant()
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')

  useEffect(() => {
    const ac = new AbortController()
    fetch(`/api/${tenant}/evergreen/formacion`, { signal: ac.signal, cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? 'Error')
        setDatos(j as Datos)
      })
      .catch((e: Error) => {
        if (e.name !== 'AbortError') setError(e.message)
      })
    return () => ac.abort()
  }, [tenant])

  const grupos = useMemo(() => {
    if (!datos) return []
    const q = normalizeText(busqueda)
    const lecciones = ordenarLecciones(datos.cursos, datos.lecciones)
    return datos.cursos
      .map((curso) => ({
        curso,
        filas: lecciones
          .filter((l) => l.course_id === curso.id)
          .map((leccion) => ({
            leccion,
            sops: datos.recursos
              .filter((r) => r.lesson_id === leccion.id)
              .filter((r) => !q || normalizeText(`${r.title} ${leccion.title} ${curso.title}`).includes(q)),
          }))
          .filter((f) => f.sops.length > 0),
      }))
      .filter((g) => g.filas.length > 0)
  }, [datos, busqueda])

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400" role="alert">
        No se pudieron cargar los SOPs: {error}
      </div>
    )
  }
  if (!datos) return <Skeleton className="h-48 w-full" />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Los documentos de cada lección de formación, en un solo sitio. Se añaden y se quitan desde Formación.
        </p>
        <SearchBox value={busqueda} onChange={setBusqueda} placeholder="Buscar un SOP…" />
      </div>

      {grupos.length === 0 ? (
        <div className="dashboard-card p-8 text-center">
          <p className="font-medium text-foreground">
            {busqueda ? 'Ningún SOP coincide con la búsqueda' : 'Todavía no hay SOPs para tu perfil'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Cuando se adjunte un documento a una lección de{' '}
            <Link href={`/${tenant}/formacion`} className="underline underline-offset-4">
              Formación
            </Link>
            , aparecerá aquí.
          </p>
        </div>
      ) : (
        grupos.map(({ curso, filas }) => (
          <section key={curso.id} className="dashboard-card space-y-3 p-4">
            <h2 className="text-sm font-semibold text-foreground">{curso.title}</h2>
            {filas.map(({ leccion, sops }) => (
              <div key={leccion.id} className="space-y-1.5">
                <Link
                  href={`/${tenant}/formacion?leccion=${leccion.id}`}
                  className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {leccion.title}
                </Link>
                <ul className="space-y-1.5">
                  {sops.map((s) => (
                    <li key={s.id}>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                      >
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate">{s.title}</span>
                        <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  )
}
