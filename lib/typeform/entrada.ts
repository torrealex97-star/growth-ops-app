import { createClient } from '@supabase/supabase-js'
import { getTenantConfigWithFallback } from '@/lib/config'
import { getOrCreateContact } from '@/lib/contacts/resolve'
import { leerToque, registrarToque, toqueTieneDatos } from '@/lib/contacts/atribucion'
import { resolverColaboradorPorCodigo } from '@/lib/collaborators/scope'
import { hechoDesdeSobre } from '@/lib/eventos/canonico'
import { verificarFirmaTypeform } from '@/lib/webhooks/typeform'
import { escaparLike } from '@/lib/search/like'
import {
  fusionarCualificacion,
  listaFormulariosFeedback,
  normalizarRespuestaTypeform,
  type RespuestaTypeform,
} from '@/lib/typeform/respuesta'

// MOTOR DEL WEBHOOK DE TYPEFORM.
//
// Mismo esqueleto que los webhooks de compra: subcuenta por el slug, firma con el secreto POR
// subcuenta, sobre guardado en raw_events ANTES de procesar (idempotente por el token de la
// respuesta: el reintento reprocesa la misma fila y sana un parcial), proyección sobre el contacto y
// hecho canónico al final. Lo que cambia es la proyección, que depende del PROPÓSITO del formulario:
//
//   · lead (por defecto): encaja o crea el contacto por email → teléfono, guarda su cualificación en
//     `contacts.qualification` y la copia a sus agendas que aún no la tengan. Quien cualifica por
//     aquí y agenda después llega a la agenda con sus respuestas (el trigger
//     `appointments_heredar_cualificacion` cubre las citas que se crean DESPUÉS).
//   · feedback: NO crea contactos (un alumno que contesta una encuesta no es un lead nuevo y
//     contaminaría «New Unique Leads»). Si encuentra a la persona por email/teléfono, deja un evento de
//     CSM con la nota y las respuestas; si no, el sobre queda guardado y se dice que el enlace es manual.

const CLAVE_SECRETO = 'TYPEFORM_WEBHOOK_SECRET'

const NORMALIZADOR = 'typeform-1'

function servicio() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

type Servicio = ReturnType<typeof servicio>

export async function procesarEntradaTypeform(opciones: {
  req: Request
  params: Promise<{ tenant: string }>
  /** Solo para pruebas: cliente y configuración inyectados en vez de los reales. */
  pruebas?: { cliente: Servicio; config: Record<string, string> }
}): Promise<Response> {
  const { req, params } = opciones
  // Cuerpo CRUDO antes de nada: la firma se calcula sobre los bytes exactos.
  const crudo = await req.text()
  const { tenant } = await params

  const sb = opciones.pruebas?.cliente ?? servicio()
  const { data: tenantRow } = await sb
    .from('tenants')
    .select('id, status')
    .eq('slug', tenant)
    .eq('status', 'active')
    .single()
  // Subcuenta inexistente y firma inválida responden IGUAL: si no, el endpoint sirve para averiguar
  // qué subcuentas existen.
  if (!tenantRow) return Response.json({ error: 'Firma inválida' }, { status: 401 })
  const tenantId = tenantRow.id as string

  const cfg = opciones.pruebas?.config ?? (await getTenantConfigWithFallback(tenantId, true))
  const firma = verificarFirmaTypeform(crudo, req.headers, cfg[CLAVE_SECRETO])
  if (!firma.valida) {
    // Rastro de seguridad sin cuerpo (no se guarda lo que un remitente NO verificado quiera) ni secreto.
    const { error } = await sb.from('raw_events').insert({
      tenant_id: tenantId,
      source: 'typeform',
      payload: { _firma_rechazada: true },
      payload_bytes: crudo.length,
      processing_status: 'rejected',
      rejection_reason: `Firma rechazada: ${firma.motivo ?? 'motivo no disponible'}`,
      request_origin: req.headers.get('origin'),
      user_agent: req.headers.get('user-agent'),
    })
    if (error) console.error('[typeform-webhook] no se pudo registrar el rechazo de firma:', error.message)
    console.warn(`[typeform-webhook] 401 en "${tenant}": ${firma.motivo}`)
    return Response.json({ error: 'Firma inválida' }, { status: 401 })
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(crudo) as Record<string, unknown>
  } catch {
    console.warn(`[typeform-webhook] 400: cuerpo vacío o JSON inválido (longitud ${crudo.length})`)
    return Response.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const respuesta = normalizarRespuestaTypeform(payload, listaFormulariosFeedback(cfg.TYPEFORM_FEEDBACK_FORMS))
  if (!respuesta) {
    // Firma válida pero no es una respuesta de formulario: se guarda ENTERO para reprocesarlo cuando
    // se entienda, y 200 para que Typeform no reintente algo que un reintento no cambia.
    const { error } = await sb.from('raw_events').insert({
      tenant_id: tenantId,
      source: 'typeform',
      payload,
      payload_bytes: crudo.length,
      processing_status: 'rejected',
      rejection_reason: 'evento no reconocido por el normalizador',
      normalizer_version: NORMALIZADOR,
      user_agent: req.headers.get('user-agent'),
    })
    if (error) console.error('[typeform-webhook] no se pudo registrar el evento no reconocido:', error.message)
    return Response.json({ recibido: true, registrado: true, procesado: false, motivo: 'evento no reconocido' })
  }

  const ahora = new Date().toISOString()
  const { data: sobrePrevio } = await sb
    .from('raw_events')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('source', 'typeform')
    .eq('source_event_id', respuesta.token)
    .maybeSingle()

  const { data: sobre, error: errorSobre } = await sb
    .from('raw_events')
    .upsert(
      {
        tenant_id: tenantId,
        source: 'typeform',
        source_event_id: respuesta.token,
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
    // Fallo nuestro y transitorio: 500 para que Typeform reintente y el sobre acabe guardado.
    console.error('[typeform-webhook] no se pudo guardar el sobre:', errorSobre?.message)
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
    if (error) console.warn('[typeform-webhook] no se pudo cerrar el sobre:', error.message)
    return Response.json(cuerpo, { status })
  }

  const base = {
    recibido: true,
    duplicado: Boolean(sobrePrevio),
    formulario: respuesta.formId,
    proposito: respuesta.proposito,
  }

  if (!respuesta.email && !respuesta.telefono) {
    // Sin identidad no se puede encajar a nadie y no se inventa un email. El sobre queda guardado.
    console.warn('[typeform-webhook] respuesta sin email ni teléfono; queda en raw_events')
    return responder({ ...base, contacto: false, motivo: 'sin email ni teléfono: enlazar el contacto es manual' })
  }

  const contactId =
    respuesta.proposito === 'lead'
      ? await proyectarLead(sb, tenantId, respuesta, ahora)
      : await buscarContacto(sb, tenantId, respuesta)
  if (contactId === 'error') return responder({ error: 'Error resolviendo el contacto' }, 500)

  if (contactId && respuesta.proposito === 'feedback') {
    const ok = await registrarFeedback(sb, tenantId, contactId, respuesta, ahora)
    if (!ok) return responder({ error: 'No se pudo registrar el feedback' }, 500)
  }

  const hechoOk = await escribirHecho(sb, tenantId, sobreId, respuesta, contactId, ahora)
  if (!hechoOk) return responder({ error: 'No se pudo registrar el hecho canónico' }, 500)

  return responder({
    ...base,
    contacto: Boolean(contactId),
    contactId: contactId ?? null,
    ...(contactId ? {} : { motivo: 'no se encontró a la persona: enlazar el contacto es manual' }),
  })
}

async function proyectarLead(
  sb: Servicio,
  tenantId: string,
  r: RespuestaTypeform,
  ahora: string
): Promise<string | 'error'> {
  const nombreCompleto = [r.nombre, r.apellidos].filter(Boolean).join(' ') || null
  const resolved = await getOrCreateContact(sb, tenantId, {
    email: r.email,
    phone: r.telefono,
    fullName: nombreCompleto,
    firstName: r.nombre,
    lastName: r.apellidos,
    instagram: r.instagram,
    age: r.edad,
    leadChannel: 'typeform',
    seenAt: r.enviadoEn ?? ahora,
  })
  if (!resolved.ok) return 'error'
  const contactId = resolved.contact.id

  // Atribución: los campos ocultos de la URL (utm_*) son el toque, y `ref` (o `referral`/`colaborador`) es
  // el código de una colaboradora, resuelto en el servidor a su perfil: la comisión va por FK, nunca por
  // texto. Un fallo aquí no tumba el webhook: el contacto y sus respuestas valen más que su procedencia.
  try {
    const codigo = r.ocultos.ref || r.ocultos.referral || r.ocultos.colaborador || null
    const perfil = codigo ? await resolverColaboradorPorCodigo(sb, tenantId, codigo) : null
    const toque = { ...leerToque(r.ocultos), source: 'typeform' }
    if (perfil || toqueTieneDatos(leerToque(r.ocultos))) {
      const resultado = await registrarToque(sb, tenantId, contactId, {
        ...toque,
        enEl: r.enviadoEn ?? ahora,
        colaboradorId: perfil?.id ?? null,
      })
      if (!resultado.ok) console.warn('[atribucion/typeform] no se pudo registrar el toque:', resultado.error)
    }
  } catch (e) {
    console.warn('[atribucion/typeform] no se pudo registrar el toque:', e instanceof Error ? e.message : e)
  }

  // Cualificación del contacto: lo nuevo gana en sus claves y se conserva lo que Calendly ya traía.
  const { data: actual } = await sb
    .from('contacts')
    .select('qualification')
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  const fusionada = fusionarCualificacion(actual?.qualification as Record<string, unknown> | null, r.cualificacion)
  const { error: errQ } = await sb
    .from('contacts')
    .update({ qualification: fusionada, qualification_updated_at: ahora })
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
  if (errQ) console.error('[typeform-webhook] no se pudo guardar la cualificación del contacto:', errQ.message)

  await copiarAAgendas(sb, tenantId, contactId, r.cualificacion)
  return contactId
}

/**
 * Copia las respuestas de Typeform a las agendas YA existentes de la persona. La agenda manda en lo que
 * ya contestó (las respuestas de Calendly son lo que dijo al reservar) y Typeform rellena el resto.
 * Una agenda cancelada no se toca: no hay nadie a quien enseñársela.
 */
async function copiarAAgendas(
  sb: Servicio,
  tenantId: string,
  contactId: string,
  cualificacionTypeform: Record<string, unknown>
): Promise<void> {
  const { data: citas, error } = await sb
    .from('appointments')
    .select('id, status, qualification')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
  if (error) {
    console.warn('[typeform-webhook] no se pudieron leer las agendas del contacto:', error.message)
    return
  }
  const pendientes = (citas ?? []) as { id: string; status: string | null; qualification: unknown }[]
  await Promise.all(
    pendientes.map(async (cita) => {
      if (/cancel/i.test(cita.status ?? '')) return
      const propia = (cita.qualification as Record<string, unknown> | null) ?? null
      const fusionada = propia ? fusionarCualificacion(cualificacionTypeform, propia) : cualificacionTypeform
      if (JSON.stringify(fusionada) === JSON.stringify(propia)) return
      const { error: errUp } = await sb
        .from('appointments')
        .update({ qualification: fusionada })
        .eq('id', cita.id)
        .eq('tenant_id', tenantId)
      if (errUp) console.warn(`[typeform-webhook] no se pudo copiar a la agenda ${cita.id}:`, errUp.message)
    })
  )
}

/** Feedback: solo se ENCUENTRA a la persona (email, luego teléfono); nunca se crea un contacto. */
async function buscarContacto(sb: Servicio, tenantId: string, r: RespuestaTypeform): Promise<string | null | 'error'> {
  if (r.email) {
    const { data, error } = await sb
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .ilike('email', escaparLike(r.email))
      .limit(1)
    if (error) return 'error'
    if (data?.[0]) return data[0].id as string
  }
  if (r.telefono) {
    const { data, error } = await sb
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('phone', r.telefono)
      .limit(1)
    if (error) return 'error'
    if (data?.[0]) return data[0].id as string
  }
  return null
}

async function registrarFeedback(
  sb: Servicio,
  tenantId: string,
  contactId: string,
  r: RespuestaTypeform,
  ahora: string
): Promise<boolean> {
  // Idempotencia por el token: un reintento no duplica el evento.
  const marca = `[typeform:${r.token}]`
  const { data: previo, error: errPrevio } = await sb
    .from('csm_events')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('contact_id', contactId)
    .like('notes', `${marca}%`)
    .limit(1)
  if (errPrevio) return false
  if (previo?.[0]) return true
  const resumen = r.respuestas
    .map((x) => `${x.q}: ${x.a}`)
    .join('\n')
    .slice(0, 4000)
  const { error } = await sb.from('csm_events').insert({
    tenant_id: tenantId,
    contact_id: contactId,
    type: 'revision',
    status: 'completado',
    event_datetime: r.enviadoEn ?? ahora,
    grade: r.nota,
    notes: `${marca} Feedback · ${r.formTitulo ?? 'formulario'}\n${resumen}`,
  })
  if (error) console.error('[typeform-webhook] no se pudo registrar el feedback:', error.message)
  return !error
}

async function escribirHecho(
  sb: Servicio,
  tenantId: string,
  sobreId: string,
  r: RespuestaTypeform,
  contactId: string | null,
  ahora: string
): Promise<boolean> {
  try {
    const { data: escrito, error } = await sb
      .from('canonical_events')
      .upsert(
        hechoDesdeSobre({
          tenantId,
          source: 'typeform',
          sourceEventId: r.token,
          rawEventId: sobreId,
          tipo: 'typeform.formulario.enviado',
          payload: {},
          recibidoEn: ahora,
          // Sin PII: ni respuestas ni email. Solo qué formulario, para qué y la nota si la hay.
          propiedades: {
            form_id: r.formId,
            form_titulo: r.formTitulo,
            proposito: r.proposito,
            respuestas: r.respuestas.length,
            nota: r.nota,
          },
          ocurridoEn: r.enviadoEn ?? ahora,
          contactId,
        }),
        { onConflict: 'tenant_id,source,source_event_id', ignoreDuplicates: true }
      )
      .select('id')
      .maybeSingle()
    if (error) {
      console.warn('[typeform-webhook] no se pudo escribir el hecho canónico:', error.message)
      return false
    }
    if (escrito?.id) {
      await sb.from('raw_events').update({ canonical_event_id: escrito.id }).eq('id', sobreId)
    }
    return true
  } catch (e) {
    console.warn('[typeform-webhook] no se pudo escribir el hecho canónico:', e instanceof Error ? e.message : e)
    return false
  }
}
