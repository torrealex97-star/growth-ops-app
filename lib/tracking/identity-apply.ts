import type { SupabaseClient } from '@supabase/supabase-js'
import {
  decidirVinculo,
  normalizarEmailIdentidad,
  normalizarTelefonoIdentidad,
  type DecisionVinculo,
} from '@/lib/tracking/identity'

type Args = {
  sb: SupabaseClient
  tenantId: string
  visitorId: string
  /** id de canonical_events del evento que trae la identidad (para auditar el vínculo). */
  canonicalEventId: string | null
  email?: string | null
  phone?: string | null
}

type Resultado = DecisionVinculo & { hechos: { visitante: boolean; toques: number } }

const SIN_HECHOS = { visitante: false, toques: 0 }

/**
 * Lee los candidatos (siempre filtrando por subcuenta en BD, máx. 2 filas por señal: basta para
 * distinguir "uno" de "ambiguo"), decide con `decidirVinculo` y escribe. Idempotente: repetir el
 * mismo evento no duplica nada (el UPDATE del visitante lleva `contact_id IS NULL` como guarda y
 * el de toques solo rellena los que no tienen contacto).
 */
export async function aplicarVinculo({
  sb,
  tenantId,
  visitorId,
  canonicalEventId,
  email,
  phone,
}: Args): Promise<Resultado> {
  const emailN = normalizarEmailIdentidad(email)
  const phoneN = normalizarTelefonoIdentidad(phone)
  if (!emailN && !phoneN) return { accion: 'omitir', motivo: 'sin_identificador', hechos: SIN_HECHOS }

  const { data: visitor, error: visitorErr } = await sb
    .from('analytics_visitors')
    .select('contact_id')
    .eq('tenant_id', tenantId)
    .eq('id', visitorId)
    .maybeSingle()
  if (visitorErr) throw visitorErr

  const buscar = async (columna: 'email_normalized' | 'phone_normalized', valor: string | null) => {
    if (!valor) return []
    const { data, error } = await sb
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq(columna, valor)
      .is('merged_into', null)
      .limit(2)
    if (error) throw error
    return (data ?? []) as { id: string }[]
  }
  const [porEmail, porTelefono] = await Promise.all([
    buscar('email_normalized', emailN),
    buscar('phone_normalized', phoneN),
  ])

  const decision = decidirVinculo({
    email: emailN,
    phone: phoneN,
    contactoActualDelVisitante: (visitor as { contact_id: string | null } | null)?.contact_id ?? null,
    porEmail,
    porTelefono,
  })

  if (decision.accion === 'vincular') {
    const { data: filas, error } = await sb
      .from('analytics_visitors')
      .update({ contact_id: decision.contactId })
      .eq('tenant_id', tenantId)
      .eq('id', visitorId)
      .is('contact_id', null)
      .select('id')
    if (error) throw error
    const vinculado = (filas?.length ?? 0) > 0

    // Los toques anteriores del visitante pasan a ser del contacto: rellena huecos, no pisa.
    const { data: toques, error: toquesErr } = await sb
      .from('analytics_touchpoints')
      .update({ contact_id: decision.contactId })
      .eq('tenant_id', tenantId)
      .eq('visitor_id', visitorId)
      .is('contact_id', null)
      .select('id')
    if (toquesErr) throw toquesErr

    if (vinculado) {
      const { error: auditErr } = await sb.from('identity_matches').insert({
        tenant_id: tenantId,
        event_id: canonicalEventId,
        contact_id: decision.contactId,
        method: decision.metodo,
        confidence: decision.confianza,
        reason: decision.motivo,
        status: 'confirmed',
        evidence: { senales: [emailN ? 'email' : null, phoneN ? 'telefono' : null].filter(Boolean) },
      })
      if (auditErr) console.warn('[identity] no se pudo auditar el vínculo:', auditErr.message)
    }
    return { ...decision, hechos: { visitante: vinculado, toques: toques?.length ?? 0 } }
  }

  if (decision.accion === 'revision') {
    const { error } = await sb.from('identity_matches').insert({
      tenant_id: tenantId,
      event_id: canonicalEventId,
      contact_id: null,
      method: 'revision_manual',
      confidence: 0,
      reason: decision.motivo,
      status: 'needs_review',
      evidence: { candidatos: decision.candidatos },
    })
    if (error) console.warn('[identity] no se pudo registrar la revisión:', error.message)
  }
  return { ...decision, hechos: SIN_HECHOS }
}
