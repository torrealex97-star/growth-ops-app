'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, GraduationCap } from 'lucide-react'

import { ordenarLecciones, resumenProgreso, siguientePendiente } from '@/lib/formacion/progreso'
import { useTenant } from '@/lib/tenant-context'

type Leccion = { id: string; course_id: string; title: string; position: number }
type Datos = { cursos: { id: string }[]; lecciones: Leccion[]; hechas: string[] }

/**
 * Entrada guiada del dashboard de la colaboradora: le dice qué hacer PRIMERO sin que nadie se lo explique.
 * Si no hay formación (o falla la carga) no pinta nada: nunca debe romper ni ensuciar su panel.
 */
export function EmpiezaAqui() {
  const tenant = useTenant()
  const [datos, setDatos] = useState<Datos | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    // `resumen=1`: solo ids, orden y títulos; la tarjeta no necesita descripciones ni enlaces.
    fetch(`/api/${tenant}/evergreen/formacion?resumen=1`, { signal: ac.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setDatos(j as Datos | null))
      .catch(() => {})
    return () => ac.abort()
  }, [tenant])

  const { resumen, siguiente } = useMemo(() => {
    if (!datos) return { resumen: null, siguiente: null }
    const ordenadas = ordenarLecciones(datos.cursos, datos.lecciones)
    return { resumen: resumenProgreso(ordenadas, datos.hechas), siguiente: siguientePendiente(ordenadas, datos.hechas) }
  }, [datos])

  if (!resumen || resumen.total === 0) return null
  const href = `/${tenant}/formacion`

  if (!siguiente) {
    return (
      <div className="dashboard-card flex items-center justify-between gap-3 px-4 py-3 text-sm">
        <span className="flex items-center gap-2 text-foreground">
          <Check className="h-4 w-4 text-[hsl(var(--brand-500))]" aria-hidden /> Formación completada
        </span>
        <Link href={href} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          Repasar
        </Link>
      </div>
    )
  }

  return (
    <section className="dashboard-card space-y-3 p-4 sm:p-5" aria-label="Empieza aquí">
      <div className="flex items-center gap-2">
        <GraduationCap className="h-5 w-5 text-[hsl(var(--brand-500))]" aria-hidden />
        <h2 className="font-display text-lg font-semibold text-foreground">Empieza aquí</h2>
        <span className="ml-auto text-xs text-muted-foreground">
          {resumen.hechas} de {resumen.total} · {resumen.porcentaje}%
        </span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={resumen.porcentaje}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progreso de formación"
      >
        <div className="h-full bg-[hsl(var(--brand-500))]" style={{ width: `${resumen.porcentaje}%` }} />
      </div>
      <p className="text-sm text-muted-foreground">
        {resumen.hechas === 0
          ? 'Mira primero este vídeo corto: te explica qué tienes que hacer y cómo usar tu panel.'
          : 'Sigue por donde lo dejaste:'}
      </p>
      <Link
        href={`${href}?leccion=${siguiente.id}`}
        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
      >
        <span className="line-clamp-2">{siguiente.title}</span>
        <ArrowRight className="h-4 w-4 shrink-0" aria-hidden />
      </Link>
    </section>
  )
}
