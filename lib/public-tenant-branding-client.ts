'use client'

import { createClient } from '@/lib/supabase/client'
import { resolveTenantBranding, type TenantBranding } from '@/lib/tenant-branding'

export type PublicTenantBrandingResult =
  | { status: 'exists'; branding: TenantBranding }
  | { status: 'missing'; branding: null }
  | { status: 'unavailable'; branding: null }

const pendingBySlug = new Map<string, Promise<PublicTenantBrandingResult>>()

/**
 * Deduplica la lectura pública que comparten el layout y el login.
 *
 * Ambas superficies se montan en la misma navegación. Sin esta promesa compartida enviaban dos
 * RPC idénticas antes de que la persona pudiera escribir. Los fallos no se cachean para que un
 * reintento posterior de la misma sesión pueda recuperarse de un corte transitorio.
 */
export function loadPublicTenantBranding(slug: string): Promise<PublicTenantBrandingResult> {
  const existing = pendingBySlug.get(slug)
  if (existing) return existing

  const request: Promise<PublicTenantBrandingResult> = Promise.resolve(
    createClient().rpc('public_tenant_branding', { p_slug: slug })
  )
    .then(({ data, error }: { data: { branding: unknown }[] | null; error: unknown }) => {
      if (error) return { status: 'unavailable', branding: null } as const
      const settings = data?.[0]?.branding
      if (!settings) return { status: 'missing', branding: null } as const
      return { status: 'exists', branding: resolveTenantBranding({ branding: settings }) } as const
    })
    .catch(() => ({ status: 'unavailable', branding: null }) as const)

  pendingBySlug.set(slug, request)
  void request.finally(() => {
    // Solo se comparte la petición en curso. El branding puede cambiar en Configuración y una
    // navegación posterior debe poder leer la versión nueva sin recargar toda la pestaña.
    if (pendingBySlug.get(slug) === request) pendingBySlug.delete(slug)
  })
  return request
}
