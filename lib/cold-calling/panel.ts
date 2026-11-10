import type { SupabaseClient } from '@supabase/supabase-js'
import { businessToday } from '@/lib/dates/business'
import { leerPaginado, trozos } from '@/lib/launch/filas'
import type { Lanzamiento } from '@/lib/launch/lanzamientos'
import { leerVentasColdCalling, resumenDinero, type VentaDeCaller } from './comisiones'
import type { AjustesColdCalling } from './config'
import { ESTADOS_CERRADOS, ESTADOS_CONTACTADO, type EstadoLead } from './estados'
import { ROL_CALLER } from './policy'

// LECTURAS de las dos pantallas de cold calling. Sin efectos: ningún GET escribe (en el origen el
// panel repartía leads y reorganizaba el equipo en cada carga, y la pantalla se recargaba cada 10 s).

type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>
const MAX_LEADS = 5000
const DIAS_INACTIVO = 7

export type Caller = { id: string; nombre: string; activa: boolean; comisiona: boolean }

/** Cold callers de la subcuenta (rol funcional cold_caller y miembro de ESTA subcuenta). */
export async function callersDelTenant(sb: SupabaseClient, tenantId: string): Promise<Caller[]> {
  const { data, error } = await sb
    .from('tenant_members')
    .select('user_id, users!inner(id, full_name, is_active, pays_commissions, roles!inner(key))')
    .eq('tenant_id', tenantId)
    .eq('users.roles.key', ROL_CALLER)
  if (error) throw new Error(`No se pudo leer el equipo de cold calling: ${error.message}`)
  type Fila = {
    user_id: string
    users: {
      id: string
      full_name: string | null
      is_active: boolean | null
      pays_commissions: boolean | null
      roles: { key: string } | { key: string }[] | null
    } | null
  }
  return ((data ?? []) as unknown as Fila[])
    .filter((f) => {
      // El filtro sobre el embebido no siempre recorta la fila padre: se vuelve a comprobar aquí.
      const rol = Array.isArray(f.users?.roles) ? f.users?.roles[0]?.key : f.users?.roles?.key
      return rol === ROL_CALLER
    })
    .map((f) => ({
      id: f.user_id,
      nombre: f.users?.full_name || 'Sin nombre',
      activa: f.users?.is_active !== false,
      comisiona: f.users?.pays_commissions !== false,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

type FilaLead = {
  id: string
  contact_id: string
  caller_id: string
  status: EstadoLead
  quality: number | null
  notes: string | null
  recordatorio_at: string | null
  intentos: number
  assigned_at: string
  first_called_at: string | null
  confirmed_at: string | null
  updated_at: string
  contacts: { full_name: string | null; phone: string | null; email: string | null } | null
}

// Solo contadores (ranking y estadísticas del equipo): sin nombre, teléfono, email ni notas.
const PROYECCION_CONTADORES =
  'id, contact_id, caller_id, status, intentos, assigned_at, first_called_at, confirmed_at, updated_at'

const PROYECCION_LEAD =
  'id, contact_id, caller_id, status, quality, notes, recordatorio_at, intentos, assigned_at, first_called_at, confirmed_at, updated_at, contacts!inner(full_name, phone, email)'

export type LeadCaller = {
  id: string
  contactId: string
  callerId: string
  nombre: string
  phone: string | null
  email: string | null
  status: EstadoLead
  quality: number | null
  notes: string | null
  recordatorioAt: string | null
  intentos: number
  assignedAt: string
  updatedAt: string
  compro: boolean
}

async function leerLeads(
  sb: SupabaseClient,
  tenantId: string,
  launchId: string,
  callerId: string | null,
  proyeccion: string = PROYECCION_LEAD
): Promise<{ filas: FilaLead[]; truncado: boolean }> {
  return leerPaginado<FilaLead>(
    (a, b) => {
      let q = sb.from('cold_calling_assignments').select(proyeccion).eq('tenant_id', tenantId).eq('launch_id', launchId)
      if (callerId) q = q.eq('caller_id', callerId)
      return q
        .order('assigned_at', { ascending: false })
        .order('id', { ascending: false })
        .range(a, b) as unknown as Pagina<FilaLead>
    },
    { max: MAX_LEADS }
  )
}

const aLead = (f: FilaLead, conVenta: Set<string>): LeadCaller => ({
  id: f.id,
  contactId: f.contact_id,
  callerId: f.caller_id,
  nombre: f.contacts?.full_name || 'Sin nombre',
  phone: f.contacts?.phone ?? null,
  email: f.contacts?.email ?? null,
  status: f.status,
  quality: f.quality === null ? null : Number(f.quality),
  notes: f.notes,
  recordatorioAt: f.recordatorio_at,
  intentos: f.intentos,
  assignedAt: f.assigned_at,
  updatedAt: f.updated_at,
  compro: conVenta.has(f.contact_id),
})

export type StatsCaller = {
  callerId: string
  nombre: string
  activa: boolean
  asignados: number
  /** Sin tocar todavía. */
  porLlamar: number
  /** Leads con al menos una llamada suya. */
  llamados: number
  /** Suma de intentos de llamada. */
  intentos: number
  /** Hubo conversación (descolgó y se habló). */
  contactados: number
  confirmados: number
  /** Ventas que le cuentan (llamó antes de la venta). */
  ventas: number
}

const CONTACTADO = new Set<string>(ESTADOS_CONTACTADO)

function statsDe(filas: FilaLead[], ventas: VentaDeCaller[], callers: Caller[], launchId: string): StatsCaller[] {
  const porCaller = new Map<string, StatsCaller>()
  const base = (id: string): StatsCaller => {
    const c = callers.find((x) => x.id === id)
    return {
      callerId: id,
      nombre: c?.nombre ?? 'Ya no está en el equipo',
      activa: c?.activa ?? false,
      asignados: 0,
      porLlamar: 0,
      llamados: 0,
      intentos: 0,
      contactados: 0,
      confirmados: 0,
      ventas: 0,
    }
  }
  for (const c of callers) if (c.activa) porCaller.set(c.id, base(c.id))
  for (const f of filas) {
    const s = porCaller.get(f.caller_id) ?? base(f.caller_id)
    s.asignados += 1
    if (f.status === 'pendiente') s.porLlamar += 1
    if (f.first_called_at) s.llamados += 1
    s.intentos += f.intentos
    if (CONTACTADO.has(f.status)) s.contactados += 1
    if (f.confirmed_at) s.confirmados += 1
    porCaller.set(f.caller_id, s)
  }
  for (const v of ventas) {
    if (v.launchId !== launchId) continue
    const s = porCaller.get(v.callerId)
    if (s) s.ventas += 1
  }
  return [...porCaller.values()].sort(
    (a, b) =>
      b.ventas - a.ventas ||
      b.confirmados - a.confirmados ||
      b.llamados - a.llamados ||
      a.nombre.localeCompare(b.nombre, 'es')
  )
}

// ── Pantalla de la cold caller ──────────────────────────────────────────────

export async function panelCaller(
  sb: SupabaseClient,
  tenantId: string,
  e: { launch: Lanzamiento; callerId: string; ajustes: AjustesColdCalling }
) {
  const [mios, equipo, callers, ventasTodas] = await Promise.all([
    leerLeads(sb, tenantId, e.launch.id, e.callerId),
    // Para el ranking basta con los contadores de cada una: sin datos de contacto de leads ajenos.
    leerLeads(sb, tenantId, e.launch.id, null, PROYECCION_CONTADORES),
    callersDelTenant(sb, tenantId),
    leerVentasColdCalling(sb, tenantId, e.ajustes.tramos),
  ])
  const yo = callers.find((c) => c.id === e.callerId)
  const misVentas = ventasTodas.filter((v) => v.callerId === e.callerId && v.launchId === e.launch.id)
  const conVenta = new Set(misVentas.map((v) => v.contactId))
  const stats = statsDe(equipo.filas, ventasTodas, callers, e.launch.id)
  const mia = stats.find((s) => s.callerId === e.callerId) ?? null
  const porLlamar = mios.filas.filter((f) => f.status === 'pendiente').length

  return {
    leads: mios.filas.map((f) => aLead(f, conVenta)),
    leadsTruncados: mios.truncado,
    stats: mia,
    // Ranking del equipo: actividad y número de ventas. El dinero de las demás NO se enseña.
    ranking: stats
      .filter((s) => s.activa || s.asignados > 0)
      .map((s, i) => ({
        posicion: i + 1,
        nombre: s.nombre,
        soyYo: s.callerId === e.callerId,
        llamados: s.llamados,
        confirmados: s.confirmados,
        ventas: s.ventas,
      })),
    dinero:
      // D9: quien no comisiona no ve cifras de comisión, ni a cero.
      yo && !yo.comisiona
        ? { estado: 'exenta' as const }
        : e.ajustes.tramos.length === 0
          ? { estado: 'sin_tramos' as const, ventas: misVentas.length }
          : {
              estado: 'ok' as const,
              ...resumenDinero(misVentas, businessToday()),
              detalle: misVentas.map((v) => ({
                saleId: v.saleId,
                numero: v.numero,
                importe: v.importe,
                fecha: v.fecha,
                finDesistimiento: v.finDesistimiento,
              })),
            },
    tramos: yo && !yo.comisiona ? [] : e.ajustes.tramos,
    objetivoConfirmados: e.ajustes.objetivoConfirmados,
    pedirMas: {
      // Solo se reparte del lanzamiento abierto, y solo cuando quedan pocos por llamar.
      disponible: e.launch.abierto && porLlamar <= e.ajustes.pedirMasSiQuedan,
      porLlamar,
      umbral: e.ajustes.pedirMasSiQuedan,
      tanda: e.ajustes.tanda,
      motivo: !e.launch.abierto
        ? 'Este lanzamiento ya no está abierto: no se reparten más leads.'
        : porLlamar > e.ajustes.pedirMasSiQuedan
          ? `Podrás pedir más cuando te queden ${e.ajustes.pedirMasSiQuedan} o menos por llamar.`
          : null,
    },
  }
}

// ── Pantalla del manager ────────────────────────────────────────────────────

type FilaEvento = {
  id: string
  assignment_id: string
  contact_id: string
  caller_id: string
  actor_id: string | null
  tipo: string
  status: string | null
  nota: string | null
  created_at: string
}

export async function panelManager(
  sb: SupabaseClient,
  tenantId: string,
  e: { launch: Lanzamiento; ajustes: AjustesColdCalling }
) {
  const [leido, callers, ventasTodas, eventosRes] = await Promise.all([
    leerLeads(sb, tenantId, e.launch.id, null),
    callersDelTenant(sb, tenantId),
    leerVentasColdCalling(sb, tenantId, e.ajustes.tramos),
    sb
      .from('cold_calling_events')
      .select('id, assignment_id, contact_id, caller_id, actor_id, tipo, status, nota, created_at')
      .eq('tenant_id', tenantId)
      .eq('launch_id', e.launch.id)
      .neq('tipo', 'asignado')
      .order('created_at', { ascending: false })
      .limit(60),
  ])
  if (eventosRes.error) throw new Error(`No se pudo leer la actividad: ${eventosRes.error.message}`)
  const eventos = (eventosRes.data ?? []) as FilaEvento[]

  const ventas = ventasTodas.filter((v) => v.launchId === e.launch.id)
  const conVenta = new Set(ventas.map((v) => v.contactId))
  const nombreDe = new Map(callers.map((c) => [c.id, c.nombre]))
  const filas = leido.filas
  const porId = new Map(filas.map((f) => [f.id, f]))

  // Nombres de quien actuó cuando no es una cold caller (un manager corrigiendo un estado).
  const otros = [...new Set(eventos.map((x) => x.actor_id).filter((id): id is string => !!id && !nombreDe.has(id)))]
  for (const ids of trozos(otros, 100)) {
    const { data } = await sb.from('users').select('id, full_name').in('id', ids)
    for (const u of (data ?? []) as { id: string; full_name: string | null }[]) {
      nombreDe.set(u.id, u.full_name || 'Sin nombre')
    }
  }

  const ahora = Date.now()
  const limite = ahora - DIAS_INACTIVO * 86_400_000
  const cerrados = new Set<string>(ESTADOS_CERRADOS)
  const atencion = filas
    .filter((f) => !cerrados.has(f.status) && !conVenta.has(f.contact_id))
    .map((f) => {
      const vencido = f.recordatorio_at !== null && Date.parse(f.recordatorio_at) < ahora
      const parado = Date.parse(f.updated_at) < limite
      return { f, motivo: vencido ? ('recordatorio_vencido' as const) : parado ? ('sin_actividad' as const) : null }
    })
    .filter((x) => x.motivo !== null)
    .sort((a, b) => Date.parse(a.f.updated_at) - Date.parse(b.f.updated_at))
    .slice(0, 100)
    .map((x) => ({ ...aLead(x.f, conVenta), caller: nombreDe.get(x.f.caller_id) ?? '—', motivo: x.motivo }))

  const dinero = resumenDinero(ventas, businessToday())
  return {
    callers: callers.filter((c) => c.activa),
    stats: statsDe(filas, ventasTodas, callers, e.launch.id),
    totales: {
      asignados: filas.length,
      porLlamar: filas.filter((f) => f.status === 'pendiente').length,
      confirmados: filas.filter((f) => f.confirmed_at).length,
      ventas: ventas.length,
      truncado: leido.truncado,
    },
    atencion,
    diasInactivo: DIAS_INACTIVO,
    actividad: eventos.map((x) => ({
      id: x.id,
      cuando: x.created_at,
      tipo: x.tipo,
      status: x.status,
      nota: x.tipo === 'reasignado' ? x.nota : null,
      lead: porId.get(x.assignment_id)?.contacts?.full_name || 'Lead',
      caller: nombreDe.get(x.caller_id) ?? '—',
      actor: x.actor_id ? (nombreDe.get(x.actor_id) ?? '—') : '—',
      porOtraPersona: x.actor_id !== x.caller_id,
    })),
    ventas: ventas.map((v) => ({
      saleId: v.saleId,
      caller: nombreDe.get(v.callerId) ?? '—',
      lead: filas.find((f) => f.contact_id === v.contactId)?.contacts?.full_name || 'Lead',
      numero: v.numero,
      importe: v.importe,
      fecha: v.fecha,
      finDesistimiento: v.finDesistimiento,
    })),
    dinero: e.ajustes.tramos.length === 0 ? null : dinero,
    hayTramos: e.ajustes.tramos.length > 0,
  }
}
