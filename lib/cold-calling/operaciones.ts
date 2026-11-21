import type { SupabaseClient } from '@supabase/supabase-js'
import { ESTADOS_CONFIRMA, ESTADOS_LLAMADA, esEstado, type EstadoLead } from './estados'
import { ErrorColdCalling } from './policy'

// Escrituras sobre un lead ya asignado. Todas llevan `tenant_id` explícito (el cliente es
// service-role) y dejan rastro en `cold_calling_events` con el actor EXPLÍCITO.

export type Asignacion = {
  id: string
  tenant_id: string
  launch_id: string
  contact_id: string
  caller_id: string
  status: EstadoLead
  notes: string | null
  recordatorio_at: string | null
  intentos: number
  first_called_at: string | null
  confirmed_at: string | null
  updated_at: string
}

const COLUMNAS =
  'id, tenant_id, launch_id, contact_id, caller_id, status, notes, recordatorio_at, intentos, first_called_at, confirmed_at, updated_at'

const MAX_NOTA = 4000

export async function leerAsignacion(sb: SupabaseClient, tenantId: string, id: string): Promise<Asignacion> {
  const { data, error } = await sb
    .from('cold_calling_assignments')
    .select(COLUMNAS)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el lead: ${error.message}`)
  if (!data) throw new ErrorColdCalling('Lead no encontrado', 404)
  return data as Asignacion
}

/**
 * Cambia el estado, las notas o el recordatorio de un lead.
 *
 * La cold caller solo toca los SUYOS. Un gestor puede corregir cualquiera, pero su cambio queda con
 * él como actor y NO cuenta como llamada de ella (no le da derecho a comisión ni suma intentos).
 *
 * `esperado` es el `updated_at` que tenía quien edita: si otra persona lo cambió entretanto se
 * responde 409 en vez de pisar su cambio en silencio.
 */
export async function actualizarLead(
  sb: SupabaseClient,
  tenantId: string,
  e: {
    assignmentId: string
    actorId: string
    esGestor: boolean
    status?: unknown
    notes?: unknown
    recordatorioAt?: unknown
    esperado?: string | null
  }
): Promise<Asignacion> {
  const actual = await leerAsignacion(sb, tenantId, e.assignmentId)
  const esSuya = actual.caller_id === e.actorId
  if (!esSuya && !e.esGestor) throw new ErrorColdCalling('Ese lead no está en tu lista', 403)

  const set: Record<string, unknown> = {}
  const eventos: Record<string, unknown>[] = []
  const base = {
    tenant_id: tenantId,
    assignment_id: actual.id,
    launch_id: actual.launch_id,
    contact_id: actual.contact_id,
    caller_id: actual.caller_id,
    actor_id: e.actorId,
  }
  const ahora = new Date().toISOString()

  if (e.status !== undefined) {
    if (!esEstado(e.status)) throw new ErrorColdCalling('Estado no válido')
    const status = e.status
    set.status = status
    if (esSuya && ESTADOS_LLAMADA.includes(status)) {
      // Cada vez que ELLA marca un estado de llamada es un intento, aunque repita "no contesta".
      set.intentos = actual.intentos + 1
      if (!actual.first_called_at) set.first_called_at = ahora
    }
    if (ESTADOS_CONFIRMA.includes(status) && !actual.confirmed_at) set.confirmed_at = ahora
    eventos.push({ ...base, tipo: 'estado', status })
  }

  if (e.notes !== undefined) {
    if (e.notes !== null && typeof e.notes !== 'string') throw new ErrorColdCalling('Nota no válida')
    const nota = e.notes === null ? null : e.notes.trim().slice(0, MAX_NOTA) || null
    if (nota !== actual.notes) {
      set.notes = nota
      eventos.push({ ...base, tipo: 'nota', nota })
    }
  }

  if (e.recordatorioAt !== undefined) {
    let cuando: string | null = null
    if (e.recordatorioAt !== null && e.recordatorioAt !== '') {
      const t = typeof e.recordatorioAt === 'string' ? Date.parse(e.recordatorioAt) : NaN
      if (!Number.isFinite(t)) throw new ErrorColdCalling('Fecha de recordatorio no válida')
      cuando = new Date(t).toISOString()
    }
    if (cuando !== actual.recordatorio_at) {
      set.recordatorio_at = cuando
      eventos.push({ ...base, tipo: 'recordatorio', nota: cuando })
    }
  }

  if (Object.keys(set).length === 0) return actual
  set.updated_at = ahora

  let q = sb.from('cold_calling_assignments').update(set).eq('tenant_id', tenantId).eq('id', actual.id)
  // El dueño no puede haber cambiado entre la lectura y la escritura (reasignación simultánea).
  q = q.eq('caller_id', actual.caller_id)
  if (e.esperado) q = q.eq('updated_at', e.esperado)
  const { data, error } = await q.select(COLUMNAS)
  if (error) throw new Error(`No se pudo guardar el lead: ${error.message}`)
  const fila = (data as Asignacion[] | null)?.[0]
  if (!fila) {
    throw new ErrorColdCalling(
      'Este lead ha cambiado mientras lo editabas. Se ha recargado: revisa y vuelve a guardar.',
      409
    )
  }

  if (eventos.length) {
    const { error: errEv } = await sb.from('cold_calling_events').insert(eventos)
    // El historial es lo que prueba la llamada: si no se pudo escribir, se dice — no vale un OK.
    if (errEv) throw new Error(`El lead se guardó pero no su historial: ${errEv.message}`)
  }
  return fila
}

/**
 * Pasa un lead a otra cold caller. Queda auditado con motivo. Se bloquea si el lead ya tiene una
 * venta: reasignarlo después cambiaría a quién se le paga una comisión ya ganada.
 */
export async function reasignarLead(
  sb: SupabaseClient,
  tenantId: string,
  e: { assignmentId: string; nuevoCallerId: string; actorId: string; motivo: string; callersValidos: Set<string> }
): Promise<Asignacion> {
  const motivo = e.motivo.trim().slice(0, 500)
  if (motivo.length < 3) throw new ErrorColdCalling('Indica el motivo de la reasignación')
  if (!e.callersValidos.has(e.nuevoCallerId)) {
    throw new ErrorColdCalling('La persona elegida no es una cold caller activa de esta subcuenta')
  }
  const actual = await leerAsignacion(sb, tenantId, e.assignmentId)
  if (actual.caller_id === e.nuevoCallerId) throw new ErrorColdCalling('El lead ya es de esa persona')

  const { data: ventas, error: errVentas } = await sb
    .from('sales')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('contact_id', actual.contact_id)
    .eq('status', 'active')
    .limit(1)
  if (errVentas) throw new Error(`No se pudo comprobar si el lead tiene venta: ${errVentas.message}`)
  if ((ventas as { id: string }[] | null)?.length) {
    throw new ErrorColdCalling('Este lead ya tiene una venta: no se puede reasignar', 409)
  }

  const ahora = new Date().toISOString()
  const { data, error } = await sb
    .from('cold_calling_assignments')
    // Vuelve a «por llamar» para la nueva persona: lo que hizo la anterior queda en el historial,
    // con su nombre, y no cuenta como llamada de la nueva.
    .update({
      caller_id: e.nuevoCallerId,
      status: 'pendiente',
      intentos: 0,
      first_called_at: null,
      recordatorio_at: null,
      assigned_at: ahora,
      updated_at: ahora,
    })
    .eq('tenant_id', tenantId)
    .eq('id', actual.id)
    .eq('caller_id', actual.caller_id)
    .select(COLUMNAS)
  if (error) throw new Error(`No se pudo reasignar el lead: ${error.message}`)
  const fila = (data as Asignacion[] | null)?.[0]
  if (!fila) throw new ErrorColdCalling('El lead ha cambiado mientras lo reasignabas. Recarga la página.', 409)

  const { error: errEv } = await sb.from('cold_calling_events').insert({
    tenant_id: tenantId,
    assignment_id: actual.id,
    launch_id: actual.launch_id,
    contact_id: actual.contact_id,
    caller_id: e.nuevoCallerId,
    actor_id: e.actorId,
    tipo: 'reasignado',
    status: 'pendiente',
    nota: motivo,
  })
  if (errEv) throw new Error(`El lead se reasignó pero no quedó registrado en el historial: ${errEv.message}`)
  return fila
}
