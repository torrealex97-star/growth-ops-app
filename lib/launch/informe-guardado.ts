import type { SupabaseClient } from '@supabase/supabase-js'
import { leerInforme } from './informe-datos'

// Informes guardados (tabla `launch_reports`): instantánea agregada del informe en un momento del
// lanzamiento. Con `tenant_id` explícito en cada consulta (service-role: RLS no protege).

export const MOMENTOS = ['intermedio', 'final'] as const
export type Momento = (typeof MOMENTOS)[number]

export type ResumenGuardado = { id: string; momento: Momento; generadoAt: string }

export async function listarGuardados(
  sb: SupabaseClient,
  tenantId: string,
  launchId: string
): Promise<ResumenGuardado[]> {
  const { data, error } = await sb
    .from('launch_reports')
    .select('id, momento, generado_at')
    .eq('tenant_id', tenantId)
    .eq('launch_id', launchId)
    .order('generado_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(`No se pudieron leer los informes guardados: ${error.message}`)
  return ((data ?? []) as { id: string; momento: Momento; generado_at: string }[]).map((r) => ({
    id: r.id,
    momento: r.momento,
    generadoAt: r.generado_at,
  }))
}

export async function guardarInforme(
  sb: SupabaseClient,
  tenantId: string,
  launchId: string,
  momento: Momento,
  userId: string,
  cfg: Record<string, string | undefined>
): Promise<string> {
  if (!(MOMENTOS as readonly string[]).includes(momento)) throw new Error('Momento no válido')
  const informe = await leerInforme(sb, tenantId, launchId, cfg) // valida también que el lanzamiento es de la subcuenta
  const { data, error } = await sb
    .from('launch_reports')
    .insert({ tenant_id: tenantId, launch_id: launchId, momento, datos: informe, generado_por: userId })
    .select('id')
    .single()
  if (error || !data) throw new Error(`No se pudo guardar el informe: ${error?.message ?? 'sin respuesta'}`)
  return (data as { id: string }).id
}

export async function leerGuardado(sb: SupabaseClient, tenantId: string, id: string) {
  const { data, error } = await sb
    .from('launch_reports')
    .select('id, momento, datos, generado_at')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el informe: ${error.message}`)
  return data as { id: string; momento: Momento; datos: unknown; generado_at: string } | null
}
