'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { cn } from '@/lib/utils'
import { DEPARTMENT_LABELS, type AppRole } from '@/lib/auth/permissions'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { useState, useEffect, useMemo } from 'react'
import { Handshake } from 'lucide-react'
import type { User } from '@/lib/types/database'
import { NAV_SECTIONS, makeNavFilter, navHrefForRole, type NavItem } from '@/lib/nav'
import { useTenant, useTenantBranding, useTenantId } from '@/lib/tenant-context'
import { TenantLogo } from '@/components/os/TenantLogo'
import { createClient } from '@/lib/supabase/client'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'

interface SidebarProps {
  user: User & { roles: { key: string; name: string } }
  isOpen: boolean
  onClose: () => void
  isSuperAdmin?: boolean
}

export function Sidebar({ user, isOpen, onClose, isSuperAdmin = false }: SidebarProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tenant = useTenant()
  const tenantId = useTenantId()
  const branding = useTenantBranding()
  const relPathname = pathname.replace(new RegExp(`^/${tenant}`), '') || '/'
  const role = user.roles.key as AppRole
  const u = user as unknown as { dept_overrides?: string[] | null; page_overrides?: string[] | null }
  const deptOverrides = u?.dept_overrides
  const pageOverrides = u?.page_overrides
  const isVisible = useMemo(
    () => makeNavFilter(role, deptOverrides, pageOverrides, isSuperAdmin),
    [role, deptOverrides, pageOverrides, isSuperAdmin]
  )
  // NAV_SECTIONS es estática y `isVisible` solo cambia si cambian rol/overrides — sin memo, cada
  // render del Sidebar (incluido cada toggle de una sola sección) recorría y filtraba TODO el
  // árbol de navegación de nuevo.
  const visibleSections = useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({ section, visibleItems: section.items.filter(isVisible) })).filter(
        ({ visibleItems }) => visibleItems.length > 0
      ),
    [isVisible]
  )

  // Un socio sin rol de dirección (p.ej. closer) no ve Finanzas por rol, pero si tiene su propia
  // fila en `partners` (vinculada por user_id, ver Configuración > Socios) debe poder llegar a ver
  // sus ganancias reales igualmente — sin que un admin tenga que sacrificar el resto de su menú
  // con "Páginas que puede ver" (ese mecanismo SUSTITUYE el menú entero, no lo amplía). Se añade
  // como item suelto en vez de tocar el filtro de roles: así ningún otro rol se ve afectado.
  const [esSocioVinculado, setEsSocioVinculado] = useState(false)
  useEffect(() => {
    let mounted = true
    createClient()
      .from('partners')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .limit(1)
      .then(({ data }) => {
        if (mounted) setEsSocioVinculado(!!data && data.length > 0)
      })
    return () => {
      mounted = false
    }
  }, [tenantId, user.id])

  const finalSections = useMemo(() => {
    const yaVisible = visibleSections.some(({ visibleItems }) =>
      visibleItems.some((i) => i.href === '/finanzas/socios')
    )
    if (!esSocioVinculado || yaVisible) return visibleSections
    const socioItem: NavItem = { label: 'Mis ganancias (socio)', href: '/finanzas/socios', icon: Handshake }
    return [...visibleSections, { section: { dept: null, items: [socioItem] }, visibleItems: [socioItem] }]
  }, [visibleSections, esSocioVinculado])

  // Secciones colapsables (estilo Notion). Se recuerda el estado en localStorage.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  useEffect(() => {
    try {
      const raw = localStorage.getItem('growth-ops-sidebar-collapsed')
      if (raw) setCollapsed(JSON.parse(raw))
    } catch {
      /* ignore */
    }
  }, [])
  const toggleSection = (dept: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [dept]: !prev[dept] }
      try {
        localStorage.setItem('growth-ops-sidebar-collapsed', JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const isActive = (href: string) => {
    const hrefPath = href.split('?')[0]
    if (hrefPath === '/dashboard') return relPathname === '/dashboard'
    return relPathname.startsWith(hrefPath)
  }

  const isChildActive = (href: string, siblings: NavItem[]) => {
    const [hrefPath, hrefQuery] = href.split('?')
    if (relPathname !== hrefPath) return false
    if (!hrefQuery) {
      const querySiblingIsActive = siblings.some((sibling) => {
        const [siblingPath, siblingQuery] = sibling.href.split('?')
        if (siblingPath !== hrefPath || !siblingQuery) return false
        return Array.from(new URLSearchParams(siblingQuery)).every(([key, value]) => searchParams.get(key) === value)
      })
      return !querySiblingIsActive
    }
    return Array.from(new URLSearchParams(hrefQuery)).every(([key, value]) => searchParams.get(key) === value)
  }

  const sidebarContent = (mobile: boolean) => (
    <>
      <div className="flex items-center justify-between px-6 py-6 border-b border-zinc-800">
        <div className="flex min-w-0 items-center gap-2.5">
          <TenantLogo branding={branding} />
          <span className="truncate font-sans text-lg font-semibold tracking-tight text-white">{branding.name}</span>
        </div>
      </div>

      <nav aria-label="Navegación principal" className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {finalSections.map(({ section, visibleItems }) => {
          const isCollapsed = !!section.dept && !!collapsed[section.dept]
          const sectionId = section.dept ? `sidebar-section-${section.dept}${mobile ? '-mobile' : ''}` : undefined
          return (
            <div key={section.dept ?? 'top'} className="space-y-1">
              {section.dept && (
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  aria-controls={sectionId}
                  onClick={() => toggleSection(section.dept as string)}
                  className="w-full flex items-center justify-between px-3 pt-4 pb-1 text-3xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                >
                  <span>{DEPARTMENT_LABELS[section.dept]}</span>
                  <ChevronDown
                    aria-hidden
                    className={cn('w-3 h-3 transition-transform', isCollapsed ? '-rotate-90' : 'rotate-0')}
                  />
                </button>
              )}
              <div id={sectionId}>
                {!isCollapsed &&
                  visibleItems.map((item) => {
                    const itemHref = navHrefForRole(item, role)
                    const active = isActive(itemHref)
                    return (
                      <div key={item.href}>
                        <Link
                          href={`/${tenant}${itemHref}`}
                          onClick={mobile ? onClose : undefined}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'relative flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 group',
                            active
                              ? 'bg-zinc-900 text-white border border-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]'
                              : 'text-zinc-400 hover:text-white hover:bg-zinc-900 border border-transparent'
                          )}
                        >
                          {active && (
                            <span
                              aria-hidden
                              className="absolute right-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-white"
                            />
                          )}
                          <item.icon
                            aria-hidden
                            className={cn(
                              'w-4 h-4 shrink-0 transition-colors',
                              active ? 'text-white' : 'text-zinc-500 group-hover:text-white'
                            )}
                          />
                          {item.label}
                          {item.children && (
                            <ChevronRight aria-hidden className="w-3 h-3 ml-auto text-muted-foreground" />
                          )}
                        </Link>

                        {item.children && active && (
                          <div className="ml-4 mt-1 space-y-1 border-l border-border pl-3">
                            {item.children.filter(isVisible).map((child) => {
                              const childActive = isChildActive(child.href, item.children ?? [])
                              return (
                                <Link
                                  key={child.href}
                                  href={`/${tenant}${child.href}`}
                                  onClick={mobile ? onClose : undefined}
                                  aria-current={childActive ? 'page' : undefined}
                                  className={cn(
                                    'flex items-center gap-3 px-3 py-1.5 rounded-lg text-sm transition-colors',
                                    childActive
                                      ? 'text-brand-400'
                                      : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                                  )}
                                >
                                  <child.icon aria-hidden className="w-3 h-3" />
                                  {child.label}
                                </Link>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
              </div>
            </div>
          )
        })}
      </nav>
    </>
  )

  return (
    <>
      <aside className="hidden h-full w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 lg:flex">
        {sidebarContent(false)}
      </aside>

      <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          id="mobile-navigation"
          side="left"
          className="flex w-64 max-w-64 flex-col gap-0 border-zinc-800 bg-zinc-950 p-0 text-foreground lg:hidden"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Navegación</SheetTitle>
            <SheetDescription>Accesos principales de {branding.name}</SheetDescription>
          </SheetHeader>
          {sidebarContent(true)}
        </SheetContent>
      </Sheet>
    </>
  )
}
