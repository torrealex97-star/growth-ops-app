import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { getTenantConfigWithFallback } from '@/lib/config'
import { getOrCreateContact } from '@/lib/contacts/resolve'
import { guardarCualificacion, registrarOrigen } from '@/lib/contacts/origen-y-cualificacion'
import { leerToque, toqueTieneDatos } from '@/lib/contacts/atribucion'
import { isValidWebhookSecret } from '@/lib/webhooks/verifySecret'
import { normalizePhoneE164 } from '@/lib/phone'
import type { Qualification } from './calidad'

// MOTOR DEL WEBHOOK DEL LANZAMIENTO (puerto de los tres webhooks de iawinners a uno solo).
//
// Mismo esqueleto que el webhook de Typeform: subcuenta por el slug, secreto POR subcuenta (guardado
// en Integraciones), sobre en `raw_events` ANTES de procesar (el reintento reprocessa la misma fila y
// sana un parcial) y proyección idempotente. Lo que cambia es lo que significa la entrega, que aquí
// la decide el parámetro `evento` de la URL de GHL (cada acción de GHL lleva su propio webhook, así
// que la URL puede decirlo — no se adivina por el cuerpo):
//
//   · alta (por defecto): encaja o crea el contacto y lo apunta al lanzamiento ACTIVO con sus UTMs.
//   · encuesta: guarda las respuestas en `contacts.qualification` (no crea contacto: la encuesta de
//     alguien que ya se apuntó no es un lead nuevo).
//   · confirmacion / desconfirmacion: marca o retira la asistencia al evento del lanzamiento activo.
//
// GHL no manda un id de evento: el sobre se deduplica por el SHA-256 del cuerpo exacto (un reintento
// de GHL repite los bytes y cae en la misma fila).

const CLAVE_SECRETO = 'LANZAMIENTO_WEBHOOK_SECRET'
const SOURCE = 'ghl-launch'
const NORMALIZADOR = 'ghl-launch-1'

const EVENTOS = ['alta', 'encuesta', 'confirmacion', 'desconfirmacion'] as const
type EventoLanzamiento = (typeof EVENTOS)[number]

function servicio(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

type Servicio = SupabaseClient

/** Últimos 9 dígitos de un teléfono: el número nacional, sin prefijo ni separadores. */
export function phoneSuffix(raw: string | null | undefined): string | null {
  const digits = (raw || '').replace(/\D/g, '')
  if (digits.length < 6) return null // demasiado corto para ser un móvil: no arriesgamos un match falso
  return digits.length > 9 ? digits.slice(-9) : digits
}

export type ConfirmMatch = {
  contactId: string
  fullName: string | null
  matchedBy: 'ghl_contact_id' | 'email' | 'phone' | 'phone_sufijo'
}

/**
 * Resuelve a qué contacto pertenece una entrega, SIN crear nada (solo el alta crea).
 * Orden de preferencia: id de GHL → email → teléfono exacto → teléfono por sufijo. El sufijo va el
 * último porque es el más laxo: dos números de países distintos pueden compartir los últimos 9
 * dígitos, así que solo se usa cuando casa con UNO y no hay nada mejor.
 */
export async function resolverContacto(
  sb: Servicio,
  tenantId: string,
  input: { ghlContactId?: string | null; email?: string | null; phone?: string | null }
): Promise<ConfirmMatch | null> {
  const { ghlContactId } = input
  const email = input.email?.toLowerCase().trim() || null
  const phoneRaw = input.phone?.trim() || null

  if (ghlContactId) {
    const { data } = await sb
      .from('contacts')
      .select('id, full_name')
      .eq('tenant_id', tenantId)
      .eq('ghl_contact_id', ghlContactId)
      .limit(1)
    const r = (data as { id: string; full_name: string | null }[] | null)?.[0]
    if (r) return { contactId: r.id, fullName: r.full_name, matchedBy: 'ghl_contact_id' }
  }

  if (email) {
    const { data } = await sb
      .from('contacts')
      .select('id, full_name')
      .eq('tenant_id', tenantId)
      .ilike('email', email)
      .limit(1)
    const r = (data as { id: string; full_name: string | null }[] | null)?.[0]
    if (r) return { contactId: r.id, fullName: r.full_name, matchedBy: 'email' }
  }

  if (phoneRaw) {
    const e164 = normalizePhoneE164(phoneRaw)
    if (e164) {
      const { data } = await sb
        .from('contacts')
        .select('id, full_name')
        .eq('tenant_id', tenantId)
        .eq('phone', e164)
        .limit(1)
      const r = (data as { id: string; full_name: string | null }[] | null)?.[0]
      if (r) return { contactId: r.id, fullName: r.full_name, matchedBy: 'phone' }
    }

    const suf = phoneSuffix(phoneRaw)
    if (suf) {
      // El match por sufijo necesita REGEXP_REPLACE: los teléfonos convivieron en la BD con todo tipo
      // de formatos. Con supabase-js se hace por RPC de SQL… que aquí no hay: se resuelve leyendo los
      // candidatos por prefijo largo y comparando el sufijo en memoria, con límite honesto.
      const { data } = await sb
        .from('contacts')
        .select('id, full_name, phone')
        .eq('tenant_id', tenantId)
        .not('phone', 'is', null)
        .like('phone', `%${suf}`)
        .limit(10)
      const conSufijo = ((data ?? []) as { id: string; full_name: string | null; phone: string | null }[]).filter(
        (r) => phoneSuffix(r.phone) === suf
      )
      if (conSufijo.length === 1) {
        return { contactId: conSufijo[0].id, fullName: conSufijo[0].full_name, matchedBy: 'phone_sufijo' }
      }
    }
  }

  return null
}

export type ResultadoConfirmacion =
  { ok: true; confirmedAt: string; yaEstaba: boolean } | { ok: false; motivo: 'sin-apuntado'; detalle: string }

/**
 * Marca la confirmación. Idempotente: si ya estaba confirmado se respeta la primera marca de tiempo
 * (pulsar el botón dos veces no debe "mover" la hora de confirmación).
 */
export async function recordConfirmation(
  sb: Servicio,
  tenantId: string,
  contactId: string,
  launchId: string,
  source = 'webhook-movil'
): Promise<ResultadoConfirmacion> {
  const { data: previa } = await sb
    .from('contact_launches')
    .select('id, confirmed_at')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .eq('launch_id', launchId)
    .maybeSingle()

  if (!previa) {
    // Sin apuntado previo no se confirma nada en el vacío: la fila la crea el alta del lead. La
    // entrega queda guardada en el sobre y la respuesta lo dice, sin inventar un contacto.
    return { ok: false, motivo: 'sin-apuntado', detalle: 'el contacto no está apuntado a este lanzamiento' }
  }
  if (previa.confirmed_at) return { ok: true, confirmedAt: previa.confirmed_at, yaEstaba: true }

  const ahora = new Date().toISOString()
  const { error } = await sb
    .from('contact_launches')
    .update({ confirmed_at: ahora, confirm_source: source })
    .eq('id', previa.id)
    .eq('tenant_id', tenantId)
  if (error) throw new Error(`No se pudo guardar la confirmación: ${error.message}`)
  return { ok: true, confirmedAt: ahora, yaEstaba: false }
}

/** Retira la confirmación (por si el lead dice que al final no puede). */
export async function clearConfirmation(
  sb: Servicio,
  tenantId: string,
  contactId: string,
  launchId: string
): Promise<void> {
  const { error } = await sb
    .from('contact_launches')
    .update({ confirmed_at: null, confirm_source: null })
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .eq('launch_id', launchId)
  if (error) throw new Error(`No se pudo retirar la confirmación: ${error.message}`)
}

// ── Normalización del cuerpo de GHL ─────────────────────────────────────────

export type EntregaLanzamiento = {
  evento: EventoLanzamiento
  ghlContactId: string | null
  email: string | null
  phone: string | null
  fullName: string | null
  respuestas: { q: string; a: string }[]
  utms: Record<string, string>
}

const CLAVES_UTM = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'utm_id',
  'utm_source_platform',
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'ttclid',
  'msclkid',
]

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export function normalizarEntrega(
  payload: Record<string, unknown>,
  eventoParam: string | null
): EntregaLanzamiento | null {
  const evento = (
    eventoParam && (EVENTOS as readonly string[]).includes(eventoParam) ? eventoParam : null
  ) as EventoLanzamiento | null
  const tipo = str(payload.evento) ?? str(payload.tipo)
  const elegido = evento ?? ((EVENTOS as readonly string[]).includes(tipo ?? '') ? (tipo as EventoLanzamiento) : null)
  if (!elegido && eventoParam) return null // pidieron un evento desconocido: no se adivina

  const contacto = (payload.contact ?? {}) as Record<string, unknown>
  const first = str(payload.first_name) ?? str(contacto.first_name)
  const last = str(payload.last_name) ?? str(contacto.last_name)
  const nombreCompuesto = [first, last].filter(Boolean).join(' ') || null
  const respuestasPayload = payload.customData ?? payload.custom_data ?? payload.respuestas

  let respuestas: { q: string; a: string }[] = []
  if (Array.isArray(respuestasPayload)) {
    respuestas = (respuestasPayload as unknown[])
      .map((r) => r as Record<string, unknown>)
      .map((r) => ({
        q: str(r.q) ?? str(r.question) ?? str(r.pregunta) ?? '',
        a: str(r.a) ?? str(r.answer) ?? str(r.respuesta) ?? '',
      }))
      .filter((r) => r.q && r.a)
  } else if (respuestasPayload && typeof respuestasPayload === 'object') {
    respuestas = Object.entries(respuestasPayload as Record<string, unknown>)
      .map(([q, a]) => ({ q, a: str(a) ?? '' }))
      .filter((r) => r.a)
  }

  const utms: Record<string, string> = {}
  const plana = { ...payload, ...contacto }
  for (const k of CLAVES_UTM) {
    const v = str(plana[k])
    if (v) utms[k] = v
  }

  const entrega: EntregaLanzamiento = {
    evento: elegido ?? (respuestas.length > 0 ? 'encuesta' : 'alta'),
    ghlContactId: str(payload.contact_id) ?? str(payload.contactId) ?? str(contacto.id),
    email: (str(payload.email) ?? str(contacto.email))?.toLowerCase() ?? null,
    phone: str(payload.phone) ?? str(contacto.phone),
    fullName: str(payload.full_name) ?? str(payload.contact_name) ?? str(contacto.full_name) ?? nombreCompuesto,
    respuestas,
    utms,
  }
  return entrega
}

// ── Punto de entrada ────────────────────────────────────────────────────────

export async function procesarWebhookLanzamiento(opciones: {
  req: Request
  params: Promise<{ tenant: string }>
  /** Solo para pruebas: cliente y configuración inyectados en vez de los reales. */
  pruebas?: { cliente: Servicio; config: Record<string, string> }
}): Promise<Response> {
  const { req, params } = opciones
  // Cuerpo CRUDO antes de nada: la deduplicación y la firma son sobre los bytes exactos.
  const crudo = await req.text()
  const { tenant } = await params
  const url = new URL(req.url)
  const eventoParam = url.searchParams.get('evento')

  const sb = opciones.pruebas?.cliente ?? servicio()
  const { data: tenantRow, error: errorTenant } = await sb
    .from('tenants')
    .select('id, status')
    .eq('slug', tenant)
    .eq('status', 'active')
    .single()
  if (errorTenant && errorTenant.code !== 'PGRST116') {
    console.error('[lanzamiento-webhook] no se pudo leer la subcuenta:', errorTenant.message)
    return Response.json({ error: 'No se pudo registrar el evento' }, { status: 500 })
  }
  // Subcuenta inexistente y firma inválida responden IGUAL: si no, el endpoint sirve para averiguar
  // qué subcuentas existen.
  if (!tenantRow) return Response.json({ error: 'Firma inválida' }, { status: 401 })
  const tenantId = tenantRow.id as string

  const cfg = opciones.pruebas?.config ?? (await getTenantConfigWithFallback(tenantId, true))
  if (!isValidWebhookSecret(req.headers.get('x-ghl-secret'), cfg[CLAVE_SECRETO])) {
    // Rastro sin cuerpo (no se guarda lo que un remitente NO verificado quiera) ni secreto.
    const { error } = await sb.from('raw_events').insert({
      tenant_id: tenantId,
      source: SOURCE,
      payload: { _firma_rechazada: true },
      payload_bytes: crudo.length,
      processing_status: 'rejected',
      rejection_reason: 'Secreto de webhook rechazado',
      request_origin: req.headers.get('origin'),
      user_agent: req.headers.get('user-agent'),
    })
    if (error) console.error('[lanzamiento-webhook] no se pudo registrar el rechazo de firma:', error.message)
    return Response.json({ error: 'Firma inválida' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(crudo) as Record<string, unknown>
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const entrega = normalizarEntrega(payload, eventoParam)
  const sourceEventId = crypto.createHash('sha256').update(crudo, 'utf8').digest('hex')
  const ahora = new Date().toISOString()

  const { data: sobrePrevio } = await sb
    .from('raw_events')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('source', SOURCE)
    .eq('source_event_id', sourceEventId)
    .maybeSingle()

  const { data: sobre, error: errorSobre } = await sb
    .from('raw_events')
    .upsert(
      {
        tenant_id: tenantId,
        source: SOURCE,
        source_event_id: sourceEventId,
        normalizer_version: NORMALIZADOR,
        payload,
        payload_bytes: crudo.length,
        processing_status: 'received' as const,
        user_agent: req.headers.get('user-agent'),
        request_origin: req.headers.get('origin'),
      },
      { onConflict: 'tenant_id,source,source_event_id', ignoreDuplicates: false }
    )
    .select('id')
    .single()
  if (errorSobre || !sobre) {
    // Fallo nuestro y transitorio: 500 para que GHL reintente y el sobre acabe guardado.
    console.error('[lanzamiento-webhook] no se pudo guardar el sobre:', errorSobre?.message)
    return Response.json({ error: 'No se pudo registrar el evento' }, { status: 500 })
  }
  const sobreId = sobre.id as string

  // Todas las salidas pasan por aquí: así el sobre nunca se queda en «received» para siempre.
  const responder = async (cuerpo: Record<string, unknown>, status = 200) => {
    const fallo = status >= 400
    const { error } = await sb
      .from('raw_events')
      .update({
        processing_status: fallo ? 'rejected' : 'normalized',
        processed_at: new Date().toISOString(),
        rejection_reason: fallo ? String(cuerpo.error ?? 'error al procesar') : null,
      })
      .eq('id', sobreId)
    if (error) console.warn('[lanzamiento-webhook] no se pudo cerrar el sobre:', error.message)
    return Response.json(cuerpo, { status })
  }

  if (!entrega) {
    return responder({ recibido: true, procesado: false, motivo: `evento desconocido: ${eventoParam}` }, 400)
  }

  try {
    const activo = await sb
      .from('launches')
      .select('id')
      .eq('tenant_id', tenantId)
      .not('opened_at', 'is', null)
      .order('fecha', { ascending: false })
      .limit(1)
    if (activo.error) throw new Error(`No se pudo leer el lanzamiento activo: ${activo.error.message}`)
    const launchId = (activo.data as { id: string }[] | null)?.[0]?.id ?? null
    if (!launchId) {
      // No hay lanzamiento abierto: la entrega queda guardada y se dice el motivo — GHL no reintenta
      // algo que un reintento no cambia, y el operador ve exactamente qué pasa.
      return responder({ recibido: true, procesado: false, motivo: 'no hay ningún lanzamiento abierto' })
    }

    const base = { recibido: true, duplicado: Boolean(sobrePrevio), evento: entrega.evento, launchId }

    if (entrega.evento === 'confirmacion' || entrega.evento === 'desconfirmacion') {
      const match = await resolverContacto(sb, tenantId, entrega)
      if (!match) {
        // Ante la duda, no se decide: la confirmación queda en el sobre para revisión manual.
        return responder({ ...base, contacto: false, motivo: 'no se identificó a la persona; enlazar es manual' })
      }
      if (entrega.evento === 'desconfirmacion') {
        await clearConfirmation(sb, tenantId, match.contactId, launchId)
      } else {
        const confirmacion = await recordConfirmation(sb, tenantId, match.contactId, launchId)
        if (!confirmacion.ok) {
          return responder({ ...base, contacto: true, contactId: match.contactId, motivo: confirmacion.detalle })
        }
      }
      return responder({ ...base, contacto: true, contactId: match.contactId, matchedBy: match.matchedBy })
    }

    if (entrega.evento === 'encuesta') {
      const match = await resolverContacto(sb, tenantId, entrega)
      if (!match)
        return responder({ ...base, contacto: false, motivo: 'no se identificó a la persona; enlazar es manual' })
      await guardarCualificacion(sb, tenantId, match.contactId, { respuestas: entrega.respuestas }, ahora)
      return responder({ ...base, contacto: true, contactId: match.contactId, matchedBy: match.matchedBy })
    }

    // ALTA: el único evento que crea contacto.
    const resolved = await getOrCreateContact(sb, tenantId, {
      email: entrega.email,
      phone: entrega.phone,
      ghlContactId: entrega.ghlContactId,
      fullName: entrega.fullName,
      leadChannel: 'ghl-lanzamiento',
      seenAt: ahora,
    })
    if (!resolved.ok) throw new Error(`No se pudo resolver el contacto: ${resolved.error}`)
    const contactId = resolved.contact.id

    if (entrega.respuestas.length > 0) {
      await guardarCualificacion(sb, tenantId, contactId, { respuestas: entrega.respuestas }, ahora)
    }

    // Atribución: el toque va a `contact_attributions` (el primer toque no se sobrescribe nunca) y
    // una copia queda en el apuntado para el ranking de anuncios del panel.
    if (toqueTieneDatos(leerToque(entrega.utms))) {
      await registrarOrigen(sb, tenantId, contactId, entrega.utms, { source: 'ghl-lanzamiento', enEl: 'lanzamiento' })
    }
    const { error: errApuntado } = await sb
      .from('contact_launches')
      .upsert(
        { tenant_id: tenantId, contact_id: contactId, launch_id: launchId, utm: entrega.utms },
        { onConflict: 'launch_id,contact_id' }
      )
    if (errApuntado) throw new Error(`No se pudo apuntar al lanzamiento: ${errApuntado.message}`)

    return responder({ ...base, contacto: true, contactId, creado: resolved.created })
  } catch (e) {
    // Error nuestro y transitorio: 500 con el sobre guardado para que GHL reintente.
    console.error('[lanzamiento-webhook] error procesando:', e instanceof Error ? e.message : e)
    return responder({ error: 'Error procesando el evento' }, 500)
  }
}
