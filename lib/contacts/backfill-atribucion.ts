import type { SupabaseClient } from '@supabase/supabase-js'
import { type ToqueAtribucion, atribuirDesdePayload } from '@/lib/contacts/atribucion'

/**
 * BACKFILL DE ATRIBUCIÓN LOCAL (sin llamadas externas).
 *
 * EL CASO REAL: la sync por pull de Calendly/GHL guarda las UTMs del payload en la CITA
 * (appointments.utm_*), pero durante semanas la escritura del TOQUE en contact_attributions
 * fallaba en silencio por un bug aparte. Resultado: hay citas con origen completo cuyo CONTACTO
 * sigue sin primera atribución — el funnel muestra "Sin atribuir" para leads que sí fueron traídos
 * por una campaña concreta, y la decisión de presupuesto se toma con datos incompletos.
 *
 * QUÉ HACE: busca pares (contacto sin utm en su atribución) + (su cita más antigua con utm) y
 * registra ese toque con EXACTAMENTE la misma semántica del webhook:
 *   · RELLENA first_utm_* solo si estaba hueco; jamás sobrescribe un origen existente.
 *   · El toque lleva la FECHA REAL de la reserva, no la de la pasada.
 *   · Un toque antiguo nunca se presenta como el último (registrarToque decide).
 *
 * IDEMPOTENCIA: correrlo dos veces no cambia nada (la segunda pasada no encuentra huecos). No toca
 * filas con dato, no inventa orígenes (una cita sin utm no produce toque) y no escribe nada si el
 * payload no aporta UTMs. Rango limitado a `limite` contactos por pasada para caber en la función.
 */
export async function backfillAtribucionLocal(
  sb: SupabaseClient,
  tenantId: string,
  opts: { limite?: number } = {}
): Promise<{
  contactosConsiderados: number
  toquesCreados: number
  toquesActualizados: number
  sinDatos: number
  errores: string[]
}> {
  const limite = Math.max(1, Math.min(opts.limite ?? 500, 2_000))
  const errores: string[] = []

  // 1) Contactos cuyo toque está SIN UTM (o sin fila de atribución activa) — el hueco.
  // `is_primary` es el único toque canónico; el resto son histórico de colaboradores.
  const { data: attrs, error: attrErr } = await sb
    .from('contact_attributions')
    .select('contact_id, first_utm_source, utm_source, is_primary')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
  if (attrErr) throw new Error(`No se pudo leer contact_attributions: ${attrErr.message}`)
  const huecos = new Set<string>()
  const conOrigen = new Set<string>()
  for (const a of attrs ?? []) {
    const r = a as {
      contact_id: string
      first_utm_source: string | null
      utm_source: string | null
      is_primary: boolean
    }
    if (r.utm_source) conOrigen.add(r.contact_id)
    else huecos.add(r.contact_id)
  }

  // 2) Contactos del tenant sin fila primary de atribución también son hueco (los nuevos que
  // llegan fuera de la ventana del backfill de la sync). La seek los cubre al fijar el objetivo.
  const { data: filas, error: filasErr } = await sb
    .from('contact_attributions')
    .select('contact_id')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
  if (!filasErr) for (const f of filas ?? []) huecos.add((f as { contact_id: string }).contact_id)

  // contactos del tenant que NO tienen NINGUNA filas primary con utm — se suman.
  const { data: contactoConAttr } = await sb.from('contacts').select('id').eq('tenant_id', tenantId)
  const idTodas = new Set((contactoConAttr ?? []).map((c) => (c as { id: string }).id))
  const { data: attrs2 } = await sb
    .from('contact_attributions')
    .select('contact_id')
    .eq('tenant_id', tenantId)
    .not('utm_source', 'is', null)
  const conOrigenSet = new Set((attrs2 ?? []).map((a) => (a as { contact_id: string }).contact_id))
  const sinFila = [...idTodas].filter((i) => !conOrigenSet.has(i))
  for (const i of sinFila) huecos.add(i)

  // 3) Objetivos: el toque lo aporta LA CITA MÁS ANTIGUA con utm — el origen del lead es su
  // primera agenda con procedencia, no la última. Todas las citas del contacto ordenadas asc.
  const { data: citas, error: citasErr } = await sb
    .from('appointments')
    .select('contact_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, appointment_datetime, created_at')
    .eq('tenant_id', tenantId)
    .not('utm_source', 'is', null)
    .order('appointment_datetime', { ascending: true })
    .limit(5_000)
  if (citasErr) throw new Error(`No se pudo leer appointments: ${citasErr.message}`)

  const primerToquePorContacto = new Map<string, Record<string, string | null>>()
  for (const c of citas ?? []) {
    const r = c as Record<string, string | null>
    if (!r.contact_id) continue
    // Guard del backfill: el contacto debe estar en el conjunto de "hueco" (no atribuido aún).
    // Un contacto ya atribuido no se toca — first-wins manda, y esto sería sobrescribir origen.
    if (conOrigen.has(r.contact_id)) continue
    if (!huecos.has(r.contact_id) && sinFila.includes(r.contact_id) === false && conOrigenSet.has(r.contact_id))
      continue
    if (!primerToquePorContacto.has(r.contact_id)) primerToquePorContacto.set(r.contact_id, r)
  }

  const objetivos = [...primerToquePorContacto.entries()].slice(0, limite)
  let toquesCreados = 0
  let toquesActualizados = 0
  let sinDatos = 0

  for (const [contactId, cita] of objetivos) {
    // El payload que se presenta a leerToque: las columnas de la cita, en la forma que
    // leerToque ya entiende (flat payload). `enEl` es la cita real (la fecha de la reserva).
    const toque: ToqueAtribucion = {
      utmSource: cita.utm_source ?? null,
      utmMedium: cita.utm_medium ?? null,
      utmCampaign: cita.utm_campaign ?? null,
      utmContent: cita.utm_content ?? null,
      utmTerm: cita.utm_term ?? null,
      enEl: cita.appointment_datetime || cita.created_at || undefined,
      evidenceSource: 'booking',
    }
    if (!toque.utmSource && !toque.utmCampaign && !toque.utmContent) {
      sinDatos++
      continue
    }
    // registrarToque rellena huecos y respeta el primero; un error NO corta la pasada (fila
    // siguiente) pero sí deja constancia para el operador.
    try {
      const r = await atribuirDesdePayload(sb, tenantId, contactId, toque, { source: 'backfill', enEl: toque.enEl })
      if (!r.resultado.ok) errores.push(`${contactId}: ${r.resultado.error}`)
      else if (r.resultado.accion === 'creada') toquesCreados++
      else if (r.resultado.accion === 'actualizada') toquesActualizados++
      else sinDatos++
      // El contacto queda ya atribuido: la siguiente pasada no lo re-toca (idempotencia dentro
      // de la MISMA invocación, no solo entre pasadas).
      conOrigen.add(contactId)
    } catch (e) {
      errores.push(`${contactId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return {
    contactosConsiderados: objetivos.length,
    toquesCreados,
    toquesActualizados,
    sinDatos,
    errores: errores.slice(0, 20),
  }
}
