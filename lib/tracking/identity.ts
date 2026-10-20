import { normalizePhoneE164 } from '@/lib/phone'

// STITCHING ANÓNIMO → CONTACTO (patrón de identidad de PostHog/Tracardi, con las reglas de
// atribución de este repo: lib/contacts/atribucion.ts).
//
// El tracker solo conoce un `anonymous_id`. Cuando un evento `lead`/`purchase` trae correo o teléfono,
// podemos enlazar ese visitante con un contacto y heredar sus toques anteriores. Aquí vive SOLO la
// decisión (pura, sin I/O, testeable); la escritura la hace `aplicarVinculo`.
//
// Principios:
//  - Ante ambigüedad NO se vincula: un vínculo equivocado mezcla la historia de dos personas.
//  - Primer vínculo gana: un visitante ya enlazado a otro contacto no se reasigna en silencio; se
//    deja en revisión.
//  - Nunca se guarda el correo/teléfono en claro en la evidencia: solo qué señal se usó.

export type MetodoIdentidad = 'email_exacto' | 'telefono_exacto' | 'email_y_telefono'

export type CandidatoContacto = { id: string }

export type EntradaVinculo = {
  email?: string | null
  phone?: string | null
  /** Contacto ya enlazado al visitante (analytics_visitors.contact_id), si lo hay. */
  contactoActualDelVisitante: string | null
  /** Contactos de la subcuenta cuyo email_normalized coincide (sin los absorbidos por merge). */
  porEmail: CandidatoContacto[]
  /** Contactos de la subcuenta cuyo phone_normalized coincide. */
  porTelefono: CandidatoContacto[]
}

export type DecisionVinculo =
  | { accion: 'vincular'; contactId: string; metodo: MetodoIdentidad; confianza: number; motivo: string }
  | { accion: 'ya_vinculado'; contactId: string }
  | { accion: 'revision'; motivo: string; candidatos: string[] }
  | { accion: 'omitir'; motivo: string }

export function normalizarEmailIdentidad(raw: string | null | undefined): string | null {
  const v = raw?.trim().toLowerCase()
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null
}

/** Solo se acepta un teléfono con prefijo internacional explícito: sin él, el número no identifica. */
export function normalizarTelefonoIdentidad(raw: string | null | undefined): string | null {
  const v = raw?.trim()
  if (!v || !(v.startsWith('+') || v.startsWith('00'))) return null
  const e164 = normalizePhoneE164(v)
  return e164.replace(/\D/g, '').length >= 8 ? e164 : null
}

const unicos = (c: CandidatoContacto[]) => [...new Set(c.map((x) => x.id))]

export function decidirVinculo(e: EntradaVinculo): DecisionVinculo {
  const email = normalizarEmailIdentidad(e.email)
  const phone = normalizarTelefonoIdentidad(e.phone)
  if (!email && !phone) return { accion: 'omitir', motivo: 'sin_identificador' }

  const porEmail = email ? unicos(e.porEmail) : []
  const porTelefono = phone ? unicos(e.porTelefono) : []

  if (porEmail.length > 1) return { accion: 'revision', motivo: 'email_ambiguo', candidatos: porEmail }
  if (porTelefono.length > 1 && porEmail.length === 0) {
    return { accion: 'revision', motivo: 'telefono_ambiguo', candidatos: porTelefono }
  }

  let contactId: string | null = null
  let metodo: MetodoIdentidad
  let confianza: number
  if (porEmail.length === 1 && porTelefono.length >= 1) {
    if (!porTelefono.includes(porEmail[0])) {
      return { accion: 'revision', motivo: 'email_y_telefono_discrepan', candidatos: [...porEmail, ...porTelefono] }
    }
    contactId = porEmail[0]
    metodo = 'email_y_telefono'
    confianza = 0.99
  } else if (porEmail.length === 1) {
    contactId = porEmail[0]
    metodo = 'email_exacto'
    confianza = 0.95
  } else if (porTelefono.length === 1) {
    contactId = porTelefono[0]
    metodo = 'telefono_exacto'
    confianza = 0.85
  } else {
    return { accion: 'omitir', motivo: 'sin_contacto_coincidente' }
  }

  if (e.contactoActualDelVisitante === contactId) return { accion: 'ya_vinculado', contactId }
  if (e.contactoActualDelVisitante) {
    return {
      accion: 'revision',
      motivo: 'visitante_ya_vinculado_a_otro_contacto',
      candidatos: [e.contactoActualDelVisitante, contactId],
    }
  }
  return { accion: 'vincular', contactId, metodo, confianza, motivo: metodo }
}
