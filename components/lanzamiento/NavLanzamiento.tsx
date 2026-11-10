'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

// Navegación común de las tres pantallas del lanzamiento. Antes Panel enlazaba a Contenido e Informe
// con dos botones sueltos y, una vez dentro, no había forma visible de volver ni de saber dónde
// estabas.
const SECCIONES = [
  { sufijo: '', label: 'Panel' },
  { sufijo: '/contenido', label: 'Contenido y checklist' },
  { sufijo: '/informe', label: 'Informe' },
]

export function NavLanzamiento({ tenant }: { tenant: string }) {
  const pathname = usePathname() ?? ''
  const base = `/${tenant}/lanzamiento`
  return (
    <nav aria-label="Secciones del lanzamiento" className="flex flex-wrap gap-1 border-b border-border">
      {SECCIONES.map((s) => {
        const href = `${base}${s.sufijo}`
        const activa = s.sufijo === '' ? pathname === base : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={activa ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              activa
                ? 'border-brand-500 text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {s.label}
          </Link>
        )
      })}
    </nav>
  )
}
