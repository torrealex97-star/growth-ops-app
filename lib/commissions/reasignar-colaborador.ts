// RECÁLCULO TRAS ASIGNAR UN COLABORADOR A UN CONTACTO.
//
// Asignar solo cambia `contact_attributions`; las ventas YA HECHAS del contacto seguían sin comisión para el
// colaborador y «por pagar» se quedaba a cero sin decir por qué. Esto las recalcula y devuelve avisos.
//
// Qué hace y qué NO (es dinero, ver docs/MONEY.md D11):
//  · Solo toca las comisiones DEL COLABORADOR asignado (`soloUsuarioId`): las de setter/closer, que pueden estar ya
//    aprobadas, ni se borran ni se recrean.
//  · Completa el % ausente de la venta desde su ficha/usuario (`completarPorcentaje`): es la decisión explícita de
//    quien reasigna, no algo que haga cualquier reparación.
//  · Nunca toca lo liquidado; es idempotente.
//  · Tiene presupuesto (la función de Vercel dura 60 s): si se agota, lo dice en vez de cortarse a media petición.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttributionPatch } from './attribution'
import { reconcileSaleCommissions } from './generate'

export const MAX_VENTAS_RECALCULO = 20
export const PRESUPUESTO_RECALCULO_MS = 35_000

export type DetalleVenta = { saleId: string; creadas: number; borradas: number; atribucion: AttributionPatch }
export type ResultadoRecalculo = {
  ventasRevisadas: number
  comisionesNuevas: number
  warnings: string[]
  detalle: DetalleVenta[]
}

export async function recalcularVentasTrasAsignar(args: {
  sb: SupabaseClient
  tenantId: string
  contactId: string
  /** user_id de la persona del perfil de colaborador asignado (null si la ficha no tiene usuario). */
  colaboradorUserId: string | null
  estadoPerfil: string | null
  reconciliar?: typeof reconcileSaleCommissions
  ahora?: () => number
}): Promise<ResultadoRecalculo> {
  const { sb, tenantId, contactId, colaboradorUserId, estadoPerfil } = args
  const reconciliar = args.reconciliar ?? reconcileSaleCommissions
  const ahora = args.ahora ?? Date.now
  const out: ResultadoRecalculo = { ventasRevisadas: 0, comisionesNuevas: 0, warnings: [], detalle: [] }

  if (estadoPerfil && estadoPerfil !== 'active') {
    out.warnings.push(
      `El colaborador está en estado «${estadoPerfil}», no activo: su comisión saldrá como «Colaborador (clásico)» hasta que lo actives.`
    )
  }
  if (!colaboradorUserId) {
    out.warnings.push('La ficha del colaborador no tiene usuario asociado: no se han podido recalcular sus comisiones.')
    return out
  }

  try {
    const { data: ventas, error } = await sb
      .from('sales')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('contact_id', contactId)
      .neq('status', 'cancelled')
      .limit(MAX_VENTAS_RECALCULO + 1)
    if (error) throw new Error(error.message)
    const lista = (ventas ?? []) as { id: string }[]

    const limite = ahora() + PRESUPUESTO_RECALCULO_MS
    let sinPorcentaje = 0
    let pendientes = Math.max(lista.length - MAX_VENTAS_RECALCULO, 0)
    for (const [i, v] of lista.slice(0, MAX_VENTAS_RECALCULO).entries()) {
      if (ahora() > limite) {
        pendientes += Math.min(lista.length, MAX_VENTAS_RECALCULO) - i
        break
      }
      const r = await reconciliar(sb, tenantId, v.id, [], {
        soloUsuarioId: colaboradorUserId,
        completarPorcentaje: true,
      })
      out.ventasRevisadas++
      out.comisionesNuevas += r.created
      out.detalle.push({ saleId: v.id, creadas: r.created, borradas: r.deleted, atribucion: r.atribucion })
      // Solo cuenta si el afiliado sin % ES el colaborador asignado (no un tercero ni alguien exento).
      if (r.afiliadoSinPorcentaje && r.afiliadoId === colaboradorUserId) sinPorcentaje++
    }
    if (sinPorcentaje > 0) {
      out.warnings.push(
        `${sinPorcentaje === 1 ? '1 venta de este contacto tiene' : `${sinPorcentaje} ventas de este contacto tienen`} a este colaborador pero NO tiene % de comisión (ni en la venta ni en su ficha): no genera comisión hasta que pongas el % en su ficha y vuelvas a asignarlo, o lo pongas en la venta.`
      )
    }
    if (pendientes > 0) {
      out.warnings.push(
        `Quedan ${pendientes} venta(s) del contacto sin recalcular (límite de ${MAX_VENTAS_RECALCULO} o de tiempo). Vuelve a asignar el colaborador para continuar.`
      )
    }
  } catch (e) {
    out.warnings.push(
      `La atribución se guardó, pero no se pudieron recalcular las comisiones de sus ventas (${e instanceof Error ? e.message : 'error desconocido'}). Vuelve a asignar el colaborador o edita la venta.`
    )
  }
  return out
}
