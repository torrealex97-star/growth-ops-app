import type { SupabaseClient } from '@supabase/supabase-js'
import { leerPaginado, trozos } from '@/lib/launch/filas'
import { esReservaAbierta } from '@/lib/metrics/agregados'
import { importeDeVenta, leerAjustes, esTablaInexistente, type Tramo } from './config'
import { ESTADOS_LLAMADA } from './estados'
import { ErrorColdCalling } from './policy'

// COMISIÓN DE LA COLD CALLER (docs/MONEY.md, D11).
//
// Una venta le paga un IMPORTE FIJO, según los tramos de la subcuenta, si se cumple TODO esto:
//   1. el lead estaba en su lista ANTES de la venta,
//   2. ELLA registró una llamada antes de la venta — se mira el historial, no el estado actual, y
//      solo cuentan los eventos que hizo ella misma mientras el lead era suyo,
//   3. la venta está activa y no es un upsell,
//   4. si era una reserva, está completada (D8: una reserva sin completar no es venta),
//   5. ella no está exenta (D9: `pays_commissions = false` es un veto absoluto).
// Es compatible con la comisión del setter o del closer: no se mira quién más cobra.
//
// Si el lead pasó por varias personas (otro lanzamiento, una reasignación), la venta es de UNA: la
// asignación más reciente anterior a la venta que cumpla 1 y 2. Nunca se paga dos veces.
//
// El cálculo es una función pura (`ventasQueCuentan`); la lectura y el volcado al ledger van
// aparte. Así "Tu dinero", el panel del manager y el ledger salen del mismo sitio.

export type AsignacionComision = {
  id: string
  launch_id: string
  contact_id: string
  caller_id: string
  assigned_at: string
}

export type EventoComision = {
  assignment_id: string
  caller_id: string
  actor_id: string | null
  tipo: string
  status: string | null
  created_at: string
}

export type VentaComision = {
  id: string
  contact_id: string
  created_at: string
  sale_date: string | null
  refund_deadline_at: string | null
  status: string
  is_upsell: boolean | null
  reservation_completed_at: string | null
  payment_plan_method: string | null
}

export type VentaDeCaller = {
  saleId: string
  contactId: string
  callerId: string
  launchId: string
  assignmentId: string
  /** Instante de la venta (para ordenar y numerar). */
  fecha: string
  /** Día hasta el que el cliente puede desistir, o null si la venta no lo lleva. */
  finDesistimiento: string | null
  /** Número de venta de esa persona dentro del lanzamiento (1 = la primera). */
  numero: number
  /** null = la subcuenta no tiene tramos configurados: no hay importe que calcular. */
  importe: number | null
}

const LLAMADAS = new Set<string>(ESTADOS_LLAMADA)

/**
 * Cuándo ocurrió la venta a efectos de "¿llamó antes?". Una venta se puede registrar días después
 * de cerrarse: si solo se mirase `created_at`, una llamada apuntada DESPUÉS del cierre real pero
 * antes de registrarlo daría comisión. Se toma lo que ocurra antes: el registro o el final del día
 * de `sale_date`.
 */
export function instanteDeVenta(v: Pick<VentaComision, 'created_at' | 'sale_date'>): number {
  const registro = Date.parse(v.created_at)
  const finDia = v.sale_date ? Date.parse(`${v.sale_date.slice(0, 10)}T23:59:59.999Z`) : NaN
  return Number.isFinite(finDia) ? Math.min(registro, finDia) : registro
}

export function ventasQueCuentan(e: {
  asignaciones: AsignacionComision[]
  eventos: EventoComision[]
  ventas: VentaComision[]
  tramos: Tramo[]
  /** Personas con `pays_commissions = false`. */
  exentos?: Set<string>
}): VentaDeCaller[] {
  // Llamadas válidas por asignación: hechas por la propia dueña del lead en ese momento.
  const llamadas = new Map<string, EventoComision[]>()
  for (const ev of e.eventos) {
    if (ev.tipo !== 'estado' || !ev.status || !LLAMADAS.has(ev.status)) continue
    if (!ev.actor_id || ev.actor_id !== ev.caller_id) continue
    llamadas.set(ev.assignment_id, [...(llamadas.get(ev.assignment_id) ?? []), ev])
  }
  const porContacto = new Map<string, AsignacionComision[]>()
  for (const a of e.asignaciones) porContacto.set(a.contact_id, [...(porContacto.get(a.contact_id) ?? []), a])

  const cuentan: Omit<VentaDeCaller, 'numero' | 'importe'>[] = []
  for (const v of e.ventas) {
    if (v.status !== 'active' || v.is_upsell) continue
    if (esReservaAbierta(v)) continue
    const instante = instanteDeVenta(v)
    const duena = (porContacto.get(v.contact_id) ?? [])
      .filter((a) => Date.parse(a.assigned_at) <= instante)
      .filter((a) =>
        (llamadas.get(a.id) ?? []).some((ev) => ev.caller_id === a.caller_id && Date.parse(ev.created_at) <= instante)
      )
      .sort((a, b) => Date.parse(b.assigned_at) - Date.parse(a.assigned_at))[0]
    if (!duena) continue
    if (e.exentos?.has(duena.caller_id)) continue
    cuentan.push({
      saleId: v.id,
      contactId: v.contact_id,
      callerId: duena.caller_id,
      launchId: duena.launch_id,
      assignmentId: duena.id,
      fecha: new Date(instante).toISOString(),
      finDesistimiento: v.refund_deadline_at,
    })
  }

  // Numeración por persona y lanzamiento, por orden de venta (desempate estable por id).
  cuentan.sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha) || (a.saleId < b.saleId ? -1 : 1))
  const n = new Map<string, number>()
  return cuentan.map((v) => {
    const clave = `${v.callerId}|${v.launchId}`
    const numero = (n.get(clave) ?? 0) + 1
    n.set(clave, numero)
    return { ...v, numero, importe: importeDeVenta(e.tramos, numero) }
  })
}

/** Reparto de lo que una persona lleva ganado: lo firme y lo que aún puede caerse por desistimiento. */
export function resumenDinero(ventas: VentaDeCaller[], hoy: string) {
  let firme = 0
  let enVentana = 0
  let sinImporte = 0
  for (const v of ventas) {
    if (v.importe === null) {
      sinImporte += 1
      continue
    }
    // El día límite cuenta todavía como plazo abierto.
    if (v.finDesistimiento && v.finDesistimiento.slice(0, 10) >= hoy) enVentana += v.importe
    else firme += v.importe
  }
  const r2 = (x: number) => Math.round(x * 100) / 100
  return { firme: r2(firme), enVentana: r2(enVentana), ventas: ventas.length, sinImporte }
}

// ── Lectura ─────────────────────────────────────────────────────────────────

const TROZO = 150
const MAX = 20000
type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/** Personas de la subcuenta que no comisionan (D9). Si no se puede leer, se lanza: no se asume "nadie". */
async function exentosDe(sb: SupabaseClient, tenantId: string): Promise<Set<string>> {
  const { data, error } = await sb
    .from('tenant_members')
    .select('user_id, users!inner(pays_commissions)')
    .eq('tenant_id', tenantId)
    .eq('users.pays_commissions', false)
  if (error) throw new Error(`No se pudo comprobar quién está exento de comisión: ${error.message}`)
  return new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))
}

/**
 * Lee lo necesario y devuelve las ventas que cuentan en la subcuenta. Solo se cargan las
 * asignaciones en las que hubo alguna llamada: sin llamada no hay comisión posible.
 */
export async function leerVentasColdCalling(
  sb: SupabaseClient,
  tenantId: string,
  tramos: Tramo[],
  filtro: { contactId?: string } = {}
): Promise<VentaDeCaller[]> {
  let asignaciones: AsignacionComision[]
  try {
    asignaciones = (
      await leerPaginado<AsignacionComision>(
        (a, b) => {
          let q = sb
            .from('cold_calling_assignments')
            .select('id, launch_id, contact_id, caller_id, assigned_at')
            .eq('tenant_id', tenantId)
            .not('first_called_at', 'is', null)
          if (filtro.contactId) q = q.eq('contact_id', filtro.contactId)
          return q.order('id', { ascending: true }).range(a, b) as unknown as Pagina<AsignacionComision>
        },
        { max: MAX }
      )
    ).filas
  } catch (e) {
    throw new Error(`No se pudieron leer las asignaciones de cold calling: ${e instanceof Error ? e.message : e}`)
  }
  if (asignaciones.length === 0) return []

  const contactIds = [...new Set(asignaciones.map((a) => a.contact_id))]
  const ventas: VentaComision[] = []
  for (const ids of trozos(contactIds, TROZO)) {
    const { data, error } = await sb
      .from('sales')
      .select(
        'id, contact_id, created_at, sale_date, refund_deadline_at, status, is_upsell, reservation_completed_at, payment_plans(method)'
      )
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .in('contact_id', ids)
    if (error) throw new Error(`No se pudieron leer las ventas: ${error.message}`)
    for (const v of (data ?? []) as unknown as (Omit<VentaComision, 'payment_plan_method'> & {
      payment_plans: { method: string | null } | { method: string | null }[] | null
    })[]) {
      const plan = Array.isArray(v.payment_plans) ? v.payment_plans[0] : v.payment_plans
      ventas.push({ ...v, payment_plan_method: plan?.method ?? null })
    }
  }
  if (ventas.length === 0) return []

  // Eventos solo de las asignaciones cuyo contacto tiene alguna venta.
  const conVenta = new Set(ventas.map((v) => v.contact_id))
  const idsAsignacion = asignaciones.filter((a) => conVenta.has(a.contact_id)).map((a) => a.id)
  const eventos: EventoComision[] = []
  for (const ids of trozos(idsAsignacion, TROZO)) {
    const { data, error } = await sb
      .from('cold_calling_events')
      .select('assignment_id, caller_id, actor_id, tipo, status, created_at')
      .eq('tenant_id', tenantId)
      .eq('tipo', 'estado')
      .in('assignment_id', ids)
    if (error) throw new Error(`No se pudo leer el historial de llamadas: ${error.message}`)
    eventos.push(...((data ?? []) as EventoComision[]))
  }

  return ventasQueCuentan({ asignaciones, eventos, ventas, tramos, exentos: await exentosDe(sb, tenantId) })
}

// ── Volcado al ledger ───────────────────────────────────────────────────────

type Existente = { id: string; sale_id: string; user_id: string; commission_amount: number | string; status: string }

/** Día 1 del mes siguiente al de la venta: el mes en que toca pagarla (mismo criterio que el resto). */
export function mesDeLiquidacion(fechaVenta: string): string {
  const d = new Date(fechaVenta)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
}

export type ResultadoSync = { creadas: number; ajustadas: number; canceladas: number; sinTramos: boolean }

/**
 * Lleva las comisiones de cold calling a `commissions` (el mismo ledger de setters y closers) para
 * que salgan en Comisiones y en el P&L. IDEMPOTENTE — se puede llamar tantas veces como haga falta:
 *   · crea la que falte, en `pending`;
 *   · ajusta persona/importe de las NO liquidadas si el orden de ventas ha cambiado;
 *   · cancela las NO liquidadas de ventas que ya no cuentan (venta anulada o devuelta, exenta…).
 * NUNCA toca una comisión liquidada (D4: lo pagado no se reescribe; la reversión de lo ya pagado
 * es una decisión abierta, D7) ni las negativas.
 *
 * Sin tramos configurados no se crea nada y lo ya existente sin liquidar se deja como está: borrar
 * los tramos por error no puede cancelar en bloque comisiones pendientes.
 */
export async function sincronizarComisionesColdCalling(sb: SupabaseClient, tenantId: string): Promise<ResultadoSync> {
  const ajustes = await leerAjustes(sb, tenantId)
  if (ajustes.tramos.length === 0) return { creadas: 0, ajustadas: 0, canceladas: 0, sinTramos: true }

  const ventas = (await leerVentasColdCalling(sb, tenantId, ajustes.tramos)).filter((v) => v.importe !== null)

  const { filas: existentes } = await leerPaginado<Existente>(
    (a, b) =>
      sb
        .from('commissions')
        .select('id, sale_id, user_id, commission_amount, status')
        .eq('tenant_id', tenantId)
        .eq('participant_type', 'cold_caller')
        .eq('direction', 'positive')
        .order('id', { ascending: true })
        .range(a, b) as unknown as Pagina<Existente>,
    { max: MAX }
  )
  const porVenta = new Map(existentes.map((x) => [x.sale_id, x]))
  const r: ResultadoSync = { creadas: 0, ajustadas: 0, canceladas: 0, sinTramos: false }

  for (const v of ventas) {
    const importe = v.importe as number
    const nota = `Cold calling · venta nº ${v.numero} del lanzamiento`
    const x = porVenta.get(v.saleId)
    if (!x) {
      // INSERT a secas: el índice único es PARCIAL (sale_id WHERE cold_caller/positive) y PostgREST
      // no puede nombrarlo en un ON CONFLICT. Si otra pasada a la vez ya la creó, el índice responde
      // 23505 y se da por hecha: dos sincronizaciones simultáneas no duplican.
      const { data, error } = await sb
        .from('commissions')
        .insert({
          tenant_id: tenantId,
          sale_id: v.saleId,
          user_id: v.callerId,
          participant_type: 'cold_caller',
          // Importe fijo: no es un porcentaje sobre una base (D11), así que ambos van a 0.
          percent: 0,
          base_amount: 0,
          commission_amount: importe,
          direction: 'positive',
          status: 'pending',
          liquidation_month: mesDeLiquidacion(v.fecha),
          notes: nota,
        })
        .select('id')
      if (error && error.code !== '23505') {
        throw new Error(`No se pudo crear la comisión de cold calling: ${error.message}`)
      }
      if ((data as { id: string }[] | null)?.length) r.creadas += 1
      continue
    }
    if (x.status === 'liquidated') continue
    if (Number(x.commission_amount) !== importe || x.user_id !== v.callerId || x.status === 'cancelled') {
      const { error } = await sb
        .from('commissions')
        .update({
          user_id: v.callerId,
          commission_amount: importe,
          notes: nota,
          status: x.status === 'cancelled' ? 'pending' : x.status,
        })
        .eq('tenant_id', tenantId)
        .eq('id', x.id)
        .neq('status', 'liquidated')
      if (error) throw new Error(`No se pudo ajustar la comisión de cold calling: ${error.message}`)
      r.ajustadas += 1
    }
  }

  const vigentes = new Set(ventas.map((v) => v.saleId))
  for (const x of existentes) {
    if (vigentes.has(x.sale_id) || x.status === 'liquidated' || x.status === 'cancelled') continue
    const { error } = await sb
      .from('commissions')
      .update({ status: 'cancelled' })
      .eq('tenant_id', tenantId)
      .eq('id', x.id)
      .neq('status', 'liquidated')
    if (error) throw new Error(`No se pudo cancelar la comisión de cold calling: ${error.message}`)
    r.canceladas += 1
  }
  return r
}

/**
 * Gancho para la reconciliación de una venta (lib/commissions/generate.ts): si el contacto de la
 * venta pasó por cold calling, resincroniza. NUNCA lanza — un fallo aquí no puede tumbar el cobro
 * ni la edición de la venta — y sale sin coste si el contacto no tiene asignación o si el módulo
 * aún no está migrado.
 */
export async function sincronizarTrasVenta(sb: SupabaseClient, tenantId: string, contactId: string): Promise<void> {
  try {
    const { data, error } = await sb
      .from('cold_calling_assignments')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .limit(1)
    if (error) {
      if (!esTablaInexistente(error)) console.error('[cold-calling] no se pudo comprobar la asignación:', error.message)
      return
    }
    if (!(data as { id: string }[] | null)?.length) return
    await sincronizarComisionesColdCalling(sb, tenantId)
  } catch (e) {
    if (e instanceof ErrorColdCalling) return
    console.error('[cold-calling] no se pudieron sincronizar las comisiones tras la venta:', e)
  }
}
