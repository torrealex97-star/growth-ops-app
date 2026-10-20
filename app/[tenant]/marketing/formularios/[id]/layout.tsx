'use client'

import Link from 'next/link'
import { useParams, usePathname } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'

export default function FormularioDetalleLayout({ children }: { children: React.ReactNode }) {
  const tenant = useTenant()
  const { id } = useParams<{ id: string }>()
  const pathname = usePathname()
  const rel = pathname.replace(new RegExp(`^/${tenant}`), '') || '/'
  const base = `/marketing/formularios/${id}`
  const tabs: RouteTab[] = [
    { label: 'Constructor', href: `/${tenant}${base}/constructor`, match: `${base}/constructor` },
    { label: 'Compartir', href: `/${tenant}${base}/compartir`, match: `${base}/compartir` },
  ]
  return (
    <div className="space-y-4">
      <Link
        href={`/${tenant}/marketing/formularios`}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Formularios
      </Link>
      <div className="max-w-full overflow-x-auto pb-1">
        <RouteTabs tabs={tabs} relPathname={rel} />
      </div>
      {children}
    </div>
  )
}
