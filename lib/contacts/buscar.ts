import type { SupabaseClient } from '@supabase/supabase-js'

// BÚSQUEDA DE CONTACTO POR CORREO, SIN CREAR.
//
// Vive fuera de `resolve.ts` a propósito: aquel módulo tiene el contrato de delegar SIEMPRE en la
// RPC atómica `contacts_get_or_create` y no tocar la tabla, porque resolver-o-crear en TypeScript
// reintroduce la carrera entre dos webhooks simultáneos (ver `tests/contactos-carrera.test.mjs`).
// Esto es otra cosa: una lectura pura que nunca crea nada, así que no comparte ese riesgo ni debe
// contaminar aquel invariante.

/**
 * Busca el contacto de una subcuenta por correo, SIN crearlo.
 *
 * Existe porque hay sitios donde aparece un correo que no justifica
 * dar de alta a nadie —por ejemplo, un asistente a una reunión de Fathom que el sync no supo
 * emparejar—. Ahí queremos el vínculo si la persona ya es contacto, y nada si no lo es: crear una
 * ficha por cada correo que pasa por delante ensucia el CRM y multiplica la PII que después hay que
 * poder borrar.
 *
 * Devuelve `null` cuando no hay correo, cuando nadie casa, o cuando casa más de uno: ante ambigüedad
 * se prefiere no vincular a vincular mal, porque un vínculo equivocado manda PII de una persona al
 * expediente de otra. Los contactos absorbidos por un merge (`merged_into`) se excluyen.
 */
export async function buscarContactoPorEmail(
  sb: SupabaseClient,
  tenantId: string,
  email: string | null | undefined
): Promise<string | null> {
  const normalizado = email?.trim().toLowerCase()
  if (!normalizado) return null
  const { data, error } = await sb
    .from('contacts')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('email_normalized', normalizado)
    .is('merged_into', null)
    .limit(2)
  if (error || !data || data.length !== 1) return null
  return (data[0] as { id: string }).id
}

/**
 * Versión por lotes de `buscarContactoPorEmail`: un solo SELECT para N correos. Devuelve email → id
 * solo para los que casan con EXACTAMENTE un contacto (ante ambigüedad no se vincula). Sin crear nada.
 */
export async function buscarContactosPorEmails(
  sb: SupabaseClient,
  tenantId: string,
  emails: Array<string | null | undefined>
): Promise<Map<string, string>> {
  const lista = [...new Set(emails.map((e) => e?.trim().toLowerCase()).filter((e): e is string => !!e))]
  const out = new Map<string, string>()
  if (lista.length === 0) return out
  const { data, error } = await sb
    .from('contacts')
    .select('id, email_normalized')
    .eq('tenant_id', tenantId)
    .in('email_normalized', lista)
    .is('merged_into', null)
  if (error || !data) return out
  const cuenta = new Map<string, string[]>()
  for (const c of data as Array<{ id: string; email_normalized: string }>)
    cuenta.set(c.email_normalized, [...(cuenta.get(c.email_normalized) ?? []), c.id])
  for (const [email, ids] of cuenta) if (ids.length === 1) out.set(email, ids[0])
  return out
}
