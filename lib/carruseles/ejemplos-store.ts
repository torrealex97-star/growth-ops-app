import { createClient } from '@supabase/supabase-js'
import { leerEjemplosDeSettings, type EjemplosTenant } from './ejemplos'

// Lectura/escritura de los ejemplos del tenant en `tenants.settings.carruseles_ejemplos`. Service role con
// `tenant_id` explícito (RLS no protege con este cliente).

const svc = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

async function leerSettings(tenantId: string): Promise<Record<string, unknown>> {
  const { data, error } = await svc().from('tenants').select('settings').eq('id', tenantId).single()
  if (error) throw new Error(error.message)
  return data.settings && typeof data.settings === 'object' ? (data.settings as Record<string, unknown>) : {}
}

export async function leerEjemplos(tenantId: string): Promise<EjemplosTenant> {
  return leerEjemplosDeSettings(await leerSettings(tenantId))
}

/** Aplica un cambio sobre el estado actual y lo guarda (lee y escribe de una vez: son cambios raros y de una persona). */
export async function actualizarEjemplos(
  tenantId: string,
  cambio: (actual: EjemplosTenant) => EjemplosTenant
): Promise<EjemplosTenant> {
  const settings = await leerSettings(tenantId)
  const siguiente = cambio(leerEjemplosDeSettings(settings))
  const { error } = await svc()
    .from('tenants')
    .update({ settings: { ...settings, carruseles_ejemplos: siguiente } })
    .eq('id', tenantId)
  if (error) throw new Error(error.message)
  return siguiente
}
