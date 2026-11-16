import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarPorcentaje } from '@/lib/auth/role-presets'
import { generateUniqueTrackingCode } from '@/lib/tracking'

/**
 * Alta ESTÁNDAR de la ficha de colaborador (`collaborator_profiles`). Un solo sitio para las tres vías
 * de alta (invitación, edición de usuario y alta directa de Colaboradores), que antes repetían esta lógica.
 *
 * Por qué importa: el dashboard estándar de la colaboradora solo aparece si existe esta ficha
 * (`resolverScopeColaborador`), así que una alta sin ficha deja a la persona con el dashboard de equipo.
 *
 * Idempotente: si ya hay ficha NO se toca (el estado real y el % los gobierna el panel de Colaboradores),
 * salvo que se pase un % explícito y la ficha aún no lo tenga.
 */
export interface FichaColaboradorArgs {
  tenantId: string
  userId: string
  nombre: string | null
  /** Código público. Por defecto, el mismo `tracking_code` del usuario para que sus `?ref=` sigan atribuyendo. */
  codigo?: string | null
  /** % de comisión. Se normaliza; vacío o inválido → null (lo fija luego el admin). */
  porcentaje?: unknown
  estadoInicial?: string
}

export type FichaColaboradorResultado = { ok: true; creada: boolean; codigo: string } | { ok: false; error: string }

export async function asegurarFichaColaborador(
  sb: SupabaseClient,
  args: FichaColaboradorArgs,
  generarCodigo: (sb: SupabaseClient) => Promise<string> = generateUniqueTrackingCode
): Promise<FichaColaboradorResultado> {
  const { data: previa, error: previaError } = await sb
    .from('collaborator_profiles')
    .select('id, code')
    .eq('tenant_id', args.tenantId)
    .eq('user_id', args.userId)
    .limit(1)
  if (previaError) return { ok: false, error: previaError.message }
  const existente = (previa as { id: string; code: string }[] | null)?.[0]
  if (existente) return { ok: true, creada: false, codigo: existente.code }

  const porcentaje = normalizarPorcentaje(args.porcentaje)
  const codigo = ((args.codigo ?? '').trim() || (await generarCodigo(sb))).toUpperCase()

  const { error: crearError } = await sb.from('collaborator_profiles').insert({
    tenant_id: args.tenantId,
    user_id: args.userId,
    code: codigo,
    name: args.nombre,
    status: args.estadoInicial ?? 'invited',
    default_commission_percent: porcentaje,
  })
  if (crearError) return { ok: false, error: crearError.message }

  // El % vive en DOS tablas; se escriben a la vez para que no queden desincronizadas.
  if (porcentaje !== null) {
    const { error: pctError } = await sb
      .from('users')
      .update({ default_affiliate_commission_percent: porcentaje })
      .eq('id', args.userId)
    if (pctError) return { ok: false, error: pctError.message }
  }
  return { ok: true, creada: true, codigo }
}
