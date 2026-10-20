'use client'

import { usePathname } from 'next/navigation'
import { useSesion, useTenant } from '@/lib/tenant-context'
import { allowedPrefixesFor, type AppRole } from '@/lib/auth/permissions'
import { isAllowedLocation } from '@/lib/marketing-navigation'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'

const TABS: RouteTab[] = [
  { label: 'Campañas', href: '/marketing/adquisicion/campanas', match: '/marketing/adquisicion/campanas' },
  { label: 'Atribución', href: '/marketing/adquisicion/atribucion', match: '/marketing/adquisicion/atribucion' },
  { label: 'VSL', href: '/marketing/adquisicion/vsl', match: '/marketing/adquisicion/vsl' },
  {
    label: 'Funnel por eventos',
    href: '/marketing/adquisicion/funnel-eventos',
    match: '/marketing/adquisicion/funnel-eventos',
  },
  { label: 'Tráfico web', href: '/marketing/adquisicion/trafico-web', match: '/marketing/adquisicion/trafico-web' },
]

export default function AdquisicionLayout({ children }: { children: React.ReactNode }) {
  const tenant = useTenant()
  const pathname = usePathname()
  const relPathname = pathname.replace(new RegExp(`^/${tenant}`), '') || '/'
  // Solo las pestañas a las que la persona puede entrar: antes todas salían y alguna acababa en 403.
  const sesion = useSesion()
  const rol = sesion?.rol as AppRole | null | undefined
  const u = sesion?.user as { dept_overrides?: string[] | null; page_overrides?: string[] | null } | undefined
  const zonas = rol && !sesion?.isSuperAdmin ? allowedPrefixesFor(rol, u?.dept_overrides, u?.page_overrides) : undefined
  const visibles = zonas && zonas.length > 0 ? TABS.filter((t) => isAllowedLocation(zonas, t.href)) : TABS
  const tabs = visibles.map((t) => ({ ...t, href: `/${tenant}${t.href}` }))

  return (
    <div className="p-6 space-y-6">
      <div className="max-w-full overflow-x-auto pb-1">
        <RouteTabs tabs={tabs} relPathname={relPathname} />
      </div>
      {children}
    </div>
  )
}
