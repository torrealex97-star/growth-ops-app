'use client'

import { usePathname } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'
import { RouteTabs, type RouteTab } from '@/components/os/RouteTabs'

export default function FeedbackAlumnosLayout({ children }: { children: React.ReactNode }) {
  const tenant = useTenant()
  const pathname = usePathname()
  const rel = pathname.replace(new RegExp(`^/${tenant}`), '') || '/'
  const tabs: RouteTab[] = [
    { label: 'Resumen', href: `/${tenant}/students/feedback`, match: '/students/feedback', exact: true },
    { label: 'Profesores', href: `/${tenant}/students/feedback/profesores`, match: '/students/feedback/profesores' },
    { label: 'Respuestas', href: `/${tenant}/students/feedback/respuestas`, match: '/students/feedback/respuestas' },
  ]
  return (
    <div className="space-y-6 p-6">
      <div className="max-w-full overflow-x-auto pb-1">
        <RouteTabs tabs={tabs} relPathname={rel} />
      </div>
      {children}
    </div>
  )
}
