'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolverScopeColaborador } from '@/lib/collaborators/scope'
import { useSesion, useTenant, useTenantId } from '@/lib/tenant-context'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'

const TABS: RouteTab[] = [
  { label: 'Contactos', href: '/crm/contactos', match: '/crm/contactos' },
  { label: 'Agendas', href: '/crm/agendas', match: '/crm/agendas' },
  { label: 'Seguimiento', href: '/crm/seguimiento', match: '/crm/seguimiento' },
  // Existe como página y como entrada de sidebar desde siempre, pero le faltaba pestaña aquí:
  // se entraba desde el menú y ninguna pestaña quedaba marcada (auditoría de dashboards, 25-sep).
  { label: 'Sin atribuir', href: '/crm/fathom-revision', match: '/crm/fathom-revision' },
]

export default function CrmLayout({ children }: { children: React.ReactNode }) {
  const tenant = useTenant()
  const pathname = usePathname()
  const relPathname = pathname.replace(new RegExp(`^/${tenant}`), '') || '/'
  const tenantId = useTenantId()
  const sesion = useSesion()
  // La colaboradora trabaja solo con lo atribuido a ella: la cola de llamadas sin atribuir es de dirección.
  const [esColab, setEsColab] = useState(false)
  useEffect(() => {
    if (!sesion) return
    let vivo = true
    resolverScopeColaborador(createClient(), sesion.userId, tenantId).then((sc) => {
      if (vivo) setEsColab(sc.tipo === 'collaborator')
    })
    return () => {
      vivo = false
    }
  }, [sesion, tenantId])
  const tabs = TABS.filter((t) => !(esColab && t.href === '/crm/fathom-revision')).map((t) => ({
    ...t,
    href: `/${tenant}${t.href}`,
  }))

  return (
    <div className="p-6 space-y-6">
      <div className="max-w-full overflow-x-auto pb-1">
        <RouteTabs tabs={tabs} relPathname={relPathname} />
      </div>
      {children}
    </div>
  )
}
