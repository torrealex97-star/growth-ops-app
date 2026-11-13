'use client'

import { usePathname } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'

// Pestañas del hub en la lista, la galería y las dos formas de crear (IA e importar); el detalle de un formulario trae su propia cabecera.
export default function FormulariosLayout({ children }: { children: React.ReactNode }) {
  const tenant = useTenant()
  const pathname = usePathname()
  const rel = pathname.replace(new RegExp(`^/${tenant}`), '') || '/'
  const tabs: RouteTab[] = [
    {
      label: 'Mis formularios',
      href: `/${tenant}/marketing/formularios`,
      match: '/marketing/formularios',
      exact: true,
    },
    {
      label: 'Plantillas',
      href: `/${tenant}/marketing/formularios/plantillas`,
      match: '/marketing/formularios/plantillas',
    },
    {
      label: 'Crear con IA',
      href: `/${tenant}/marketing/formularios/crear-ia`,
      match: '/marketing/formularios/crear-ia',
    },
    {
      label: 'Importar',
      href: `/${tenant}/marketing/formularios/importar`,
      match: '/marketing/formularios/importar',
    },
  ]
  const isHub = [
    '/marketing/formularios',
    '/marketing/formularios/plantillas',
    '/marketing/formularios/crear-ia',
    '/marketing/formularios/importar',
  ].includes(rel)
  return (
    <div className="p-6 space-y-6">
      {isHub && (
        <div className="max-w-full overflow-x-auto pb-1">
          <RouteTabs tabs={tabs} relPathname={rel} />
        </div>
      )}
      {children}
    </div>
  )
}
