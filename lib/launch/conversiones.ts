import type { SupabaseClient } from '@supabase/supabase-js'
import { isAttended } from '@/lib/appointments/status'
import { esReservaAbierta } from '@/lib/metrics/agregados'
import { leerPaginado, trozos } from './filas'

// Cruce de los apuntados a un lanzamiento con agendas y ventas. Lo usan el panel y el informe para
// que las dos pantallas cuenten lo mismo.
//
// Se cuentan CONTACTOS (no citas ni ventas) con una cita / una venta CREADA desde el primer registro
// del lanzamiento: no se atribuye una compra anterior al evento. Una reserva abierta no es venta
// (docs/MONEY.md, D8). Si una de las dos lecturas falla, se devuelve `…Leidas: false` y quien pinta
// enseña un hueco, nunca un cero.

const TROZO = 150
const MAX_POR_TROZO = 5000
const CANCELADAS = new Set(['cancelled', 'cancelled_admin', 'rescheduled'])

export type Conversiones = {
  conCita: Set<string>
  asistieron: Set<string>
  conVenta: Set<string>
  agendasLeidas: boolean
  ventasLeidas: boolean
}

type FilaVenta = {
  id: string
  contact_id: string
  reservation_completed_at: string | null
  payment_plans: { method: string | null } | { method: string | null }[] | null
}

export async function leerConversiones(
  sb: SupabaseClient,
  tenantId: string,
  contactIds: string[],
  desde: string | null
): Promise<Conversiones> {
  const out: Conversiones = {
    conCita: new Set(),
    asistieron: new Set(),
    conVenta: new Set(),
    agendasLeidas: true,
    ventasLeidas: true,
  }
  if (!desde || contactIds.length === 0) return out

  for (const ids of trozos(contactIds, TROZO)) {
    try {
      const { filas, truncado } = await leerPaginado<{ id: string; contact_id: string; status: string }>(
        (a, b) =>
          sb
            .from('appointments')
            .select('id, contact_id, status')
            .eq('tenant_id', tenantId)
            .in('contact_id', ids)
            .gte('created_at', desde)
            .order('id', { ascending: true })
            .range(a, b),
        { max: MAX_POR_TROZO }
      )
      if (truncado) out.agendasLeidas = false
      for (const c of filas) {
        if (CANCELADAS.has(c.status)) continue
        out.conCita.add(c.contact_id)
        if (isAttended(c.status)) out.asistieron.add(c.contact_id)
      }
    } catch {
      out.agendasLeidas = false
      break
    }
  }

  for (const ids of trozos(contactIds, TROZO)) {
    try {
      const { filas, truncado } = await leerPaginado<FilaVenta>(
        (a, b) =>
          sb
            .from('sales')
            .select('id, contact_id, reservation_completed_at, payment_plans(method)')
            .eq('tenant_id', tenantId)
            .eq('status', 'active')
            .in('contact_id', ids)
            .gte('created_at', desde)
            .order('id', { ascending: true })
            .range(a, b) as unknown as PromiseLike<{ data: FilaVenta[] | null; error: { message: string } | null }>,
        { max: MAX_POR_TROZO }
      )
      if (truncado) out.ventasLeidas = false
      for (const v of filas) {
        const plan = Array.isArray(v.payment_plans) ? v.payment_plans[0] : v.payment_plans
        if (
          esReservaAbierta({
            payment_plan_method: plan?.method ?? null,
            reservation_completed_at: v.reservation_completed_at,
          })
        )
          continue
        out.conVenta.add(v.contact_id)
      }
    } catch {
      out.ventasLeidas = false
      break
    }
  }
  return out
}
