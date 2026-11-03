import type { SupabaseClient } from '@supabase/supabase-js'

// Reasignación de closer: qué hay que hacer en el proveedor donde se agendó la cita y qué closer
// es válido en la subcuenta. Puro salvo `closerDeLaSubcuenta` (solo lee).

export type CloserElegido = {
  id: string
  email: string | null
  calendly_email: string | null
  full_name: string | null
}

/**
 * Closer válido PARA ESTA SUBCUENTA. `users` no tiene tenant_id (el rol es global), así que sin mirar
 * `tenant_members` un admin podía asignar el closer de otra subcuenta con solo conocer su id.
 */
export async function closerDeLaSubcuenta(
  sb: SupabaseClient,
  tenantId: string,
  closerId: string,
  isSuperAdmin = false
): Promise<CloserElegido | null> {
  const { data } = await sb
    .from('users')
    .select('id, email, calendly_email, full_name, roles(key)')
    .eq('id', closerId)
    .maybeSingle()
  const rol = (data?.roles as { key?: string } | null)?.key
  if (!data || (rol !== 'closer' && rol !== 'admin')) return null
  if (!isSuperAdmin) {
    const { data: miembro } = await sb
      .from('tenant_members')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('user_id', closerId)
      .maybeSingle()
    if (!miembro) return null
  }
  return data as unknown as CloserElegido
}

export type CitaParaReasignar = {
  external_source: string | null
  external_id: string | null
  calendly_event_uuid: string | null
  appointment_datetime: string | null
}

/**
 * Dónde se refleja el cambio:
 *  · 'ghl'      → la cita vive en GHL: se cambia su `assignedUserId`.
 *  · 'calendly' → Calendly no permite cambiar el anfitrión de un evento: hay que crear la cita en el
 *                 calendario del nuevo closer y cancelar la anterior (solo si aún no ha pasado).
 *  · 'solo_app' → manual, o Calendly ya pasada (no se puede mover): solo cambia la app.
 */
export function proveedorDeReasignacion(c: CitaParaReasignar, ahora = new Date()): 'ghl' | 'calendly' | 'solo_app' {
  if (c.external_source === 'ghl' && c.external_id) return 'ghl'
  if (c.external_source === 'calendly' && c.calendly_event_uuid) {
    const inicio = c.appointment_datetime ? new Date(c.appointment_datetime) : null
    return inicio && inicio > ahora ? 'calendly' : 'solo_app'
  }
  return 'solo_app'
}
