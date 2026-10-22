import type { SupabaseClient } from '@supabase/supabase-js'
import { resolverColaboradorPorCodigo } from '@/lib/collaborators/scope'
import { leerToque, registrarToque, toqueTieneDatos } from '@/lib/contacts/atribucion'
import { fusionarCualificacion } from '@/lib/contacts/cualificacion'

// PROYECCIÓN DE UN LEAD DE FORMULARIO sobre el contacto: de dónde vino y qué contestó.
// La comparten el webhook de Typeform y el módulo de Formularios propio, para que el mismo lead se
// atribuya y se cualifique igual venga de donde venga (antes solo lo hacía Typeform).

/**
 * Atribución: los parámetros de la URL (utm_*, fbclid…) son el toque, y `ref` (o `referral`/`colaborador`)
 * es el código de una colaboradora, resuelto en el servidor a su perfil: la comisión va por FK, nunca por
 * texto. Un fallo aquí NO se propaga: el contacto y sus respuestas valen más que su procedencia.
 */
export async function registrarOrigen(
  sb: SupabaseClient,
  tenantId: string,
  contactId: string,
  ocultos: Record<string, string>,
  opciones: { source: string; enEl: string }
): Promise<void> {
  try {
    const codigo = ocultos.ref || ocultos.referral || ocultos.colaborador || null
    const perfil = codigo ? await resolverColaboradorPorCodigo(sb, tenantId, codigo) : null
    const leido = leerToque(ocultos)
    if (perfil || toqueTieneDatos(leido)) {
      const resultado = await registrarToque(sb, tenantId, contactId, {
        ...leido,
        source: opciones.source,
        enEl: opciones.enEl,
        colaboradorId: perfil?.id ?? null,
      })
      if (!resultado.ok) console.warn(`[atribucion/${opciones.source}] no se pudo registrar el toque:`, resultado.error)
    }
  } catch (e) {
    console.warn(`[atribucion/${opciones.source}] no se pudo registrar el toque:`, e instanceof Error ? e.message : e)
  }
}

/**
 * Guarda la cualificación en el contacto (lo nuevo gana en sus claves; se conserva lo anterior) y la copia
 * a sus agendas YA existentes. Las agendas que se creen después la heredan por el trigger
 * `appointments_heredar_cualificacion`.
 */
export async function guardarCualificacion(
  sb: SupabaseClient,
  tenantId: string,
  contactId: string,
  cualificacion: Record<string, unknown>,
  ahora: string
): Promise<void> {
  const { data: actual } = await sb
    .from('contacts')
    .select('qualification')
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const fusionada = fusionarCualificacion(actual?.qualification as Record<string, unknown> | null, cualificacion)
  const { error } = await sb
    .from('contacts')
    .update({ qualification: fusionada, qualification_updated_at: ahora })
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
  if (error) console.error('[cualificacion] no se pudo guardar la cualificación del contacto:', error.message)
  await copiarAAgendas(sb, tenantId, contactId, cualificacion)
}

/**
 * Copia las respuestas a las agendas YA existentes de la persona. La agenda manda en lo que ya contestó
 * (las respuestas de Calendly son lo que dijo al reservar) y el formulario rellena el resto. Una agenda
 * cancelada no se toca: no hay nadie a quien enseñársela.
 */
async function copiarAAgendas(
  sb: SupabaseClient,
  tenantId: string,
  contactId: string,
  cualificacion: Record<string, unknown>
): Promise<void> {
  const { data: citas, error } = await sb
    .from('appointments')
    .select('id, status, qualification')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
  if (error) {
    console.warn('[cualificacion] no se pudieron leer las agendas del contacto:', error.message)
    return
  }
  await Promise.all(
    ((citas ?? []) as { id: string; status: string | null; qualification: unknown }[]).map(async (cita) => {
      if (/cancel/i.test(cita.status ?? '')) return
      const propia = (cita.qualification as Record<string, unknown> | null) ?? null
      const fusionada = propia ? fusionarCualificacion(cualificacion, propia) : cualificacion
      if (JSON.stringify(fusionada) === JSON.stringify(propia)) return
      const { error: errUp } = await sb
        .from('appointments')
        .update({ qualification: fusionada })
        .eq('id', cita.id)
        .eq('tenant_id', tenantId)
      if (errUp) console.warn(`[cualificacion] no se pudo copiar a la agenda ${cita.id}:`, errUp.message)
    })
  )
}
