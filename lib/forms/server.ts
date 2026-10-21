// Utilidades de servidor del módulo (service role). Solo para rutas de API: nunca importar desde
// código de cliente.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { formConfigSchema } from './schema'
import type { FormConfig } from './types'

export function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export interface PublishedForm {
  tenantId: string
  formId: string
  name: string
  category: string
  audience: string
  settings: { closeAt?: string; maxResponses?: number }
  versionId: string
  version: number
  config: FormConfig
}

export type LoadResult = { ok: true; form: PublishedForm } | { ok: false; status: number; error: string }

/**
 * Resuelve un formulario PÚBLICO por (subcuenta, slug): solo si está publicado, no ha cerrado y no
 * ha alcanzado su tope de respuestas. Cada lectura va acotada al tenant_id resuelto.
 */
export async function loadPublishedForm(sb: SupabaseClient, tenantSlug: string, formSlug: string): Promise<LoadResult> {
  const { data: tenant } = await sb.from('tenants').select('id, status').eq('slug', tenantSlug).maybeSingle()
  if (!tenant || tenant.status !== 'active') return { ok: false, status: 404, error: 'Formulario no encontrado' }

  const { data: form } = await sb
    .from('forms')
    .select('id, name, category, audience, status, settings, published_version_id')
    .eq('tenant_id', tenant.id)
    .eq('slug', formSlug)
    .maybeSingle()
  if (!form || form.status !== 'published' || !form.published_version_id) {
    return { ok: false, status: 404, error: 'Formulario no encontrado' }
  }

  const settings = (form.settings ?? {}) as PublishedForm['settings']
  if (settings.closeAt && Date.parse(settings.closeAt) < Date.now()) {
    return { ok: false, status: 410, error: 'Este formulario ya no admite respuestas.' }
  }

  const { data: version } = await sb
    .from('form_versions')
    .select('id, version, config')
    .eq('tenant_id', tenant.id)
    .eq('id', form.published_version_id)
    .maybeSingle()
  const parsed = version ? formConfigSchema.safeParse(version.config) : null
  if (!version || !parsed?.success) return { ok: false, status: 404, error: 'Formulario no disponible' }

  if (settings.maxResponses) {
    const { count } = await sb
      .from('form_responses')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant.id)
      .eq('form_id', form.id)
      .eq('status', 'completed')
    if ((count ?? 0) >= settings.maxResponses) {
      return { ok: false, status: 410, error: 'Este formulario ha alcanzado su límite de respuestas.' }
    }
  }

  return {
    ok: true,
    form: {
      tenantId: tenant.id,
      formId: form.id,
      name: form.name,
      category: form.category,
      audience: form.audience,
      settings,
      versionId: version.id,
      version: version.version,
      config: parsed.data as FormConfig,
    },
  }
}
