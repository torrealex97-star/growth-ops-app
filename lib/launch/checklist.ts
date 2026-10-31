import type { SupabaseClient } from '@supabase/supabase-js'
import { CLAVES_CHECKLIST } from './plantilla'

// Ítems marcados del checklist de un lanzamiento (tabla `launch_checklist`). Con `tenant_id`
// explícito en cada consulta: el cliente es service-role y RLS no protege.

export async function listarMarcados(sb: SupabaseClient, tenantId: string, launchId: string): Promise<string[]> {
  const { data, error } = await sb
    .from('launch_checklist')
    .select('item_key')
    .eq('tenant_id', tenantId)
    .eq('launch_id', launchId)
  if (error) throw new Error(`No se pudo leer el checklist: ${error.message}`)
  return ((data ?? []) as { item_key: string }[]).map((r) => r.item_key).filter((k) => CLAVES_CHECKLIST.has(k))
}

export async function marcarItem(
  sb: SupabaseClient,
  tenantId: string,
  launchId: string,
  key: string,
  hecho: boolean,
  userId: string
): Promise<void> {
  if (!CLAVES_CHECKLIST.has(key)) throw new Error('Ítem no válido')
  const { data: lanz } = await sb
    .from('launches')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('id', launchId)
    .maybeSingle()
  if (!lanz) throw new Error('Lanzamiento no encontrado')
  const q = hecho
    ? sb
        .from('launch_checklist')
        .upsert(
          { tenant_id: tenantId, launch_id: launchId, item_key: key, done_by: userId },
          { onConflict: 'launch_id,item_key', ignoreDuplicates: true }
        )
    : sb.from('launch_checklist').delete().eq('tenant_id', tenantId).eq('launch_id', launchId).eq('item_key', key)
  const { error } = await q
  if (error) throw new Error(`No se pudo guardar el ítem: ${error.message}`)
}
