'use client'

import { usePathname } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'

// Pestañas del hub solo en la lista y la galería; el detalle de un formulario trae su propia cabecera.
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
  ]
  const isHub = rel === '/marketing/formularios' || rel === '/marketing/formularios/plantillas'
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
