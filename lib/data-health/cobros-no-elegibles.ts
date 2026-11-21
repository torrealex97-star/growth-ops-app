// Fila de `collections` (con su venta embebida) → entrada del control `cobro_sin_comision_visible`.
//
// Es una función PURA a propósito: el mapeo de lo que devuelve PostgREST (la venta y su plan pueden llegar como
// objeto o como array) es donde vive el riesgo de equivocarse, y así se prueba sin base de datos.

import { isActiveSale } from '@/lib/analytics'

export type SaleDeCobro = {
  status: string | null
  setter_id: string | null
  closer_id: string | null
  affiliate_id: string | null
  affiliate_commission_percent: number | string | null
  reservation_completed_at: string | null
  payment_plans: { method: string | null } | { method: string | null }[] | null
}

export type FilaCobroNoElegible = { id: string; sales: SaleDeCobro | SaleDeCobro[] | null }

export type CobroNoElegible = {
  id: string
  /** La venta no está vigente (cancelada, devuelta, contracargo…): su comisión se revirtió o nunca existió. */
  ventaNoVigente: boolean
  /** Setter, closer o colaborador con % > 0 que NO esté exento de comisión (D9). */
  hayAQuienComisionar: boolean
  /** Reserva sin completar: no comisiona POR DISEÑO (D8 de MONEY.md). */
  reservaAbierta: boolean
}

const uno = <T>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

export function aCobroNoElegible(fila: FilaCobroNoElegible, exentos: ReadonlySet<string>): CobroNoElegible {
  const venta = uno(fila.sales)
  if (!venta) return { id: fila.id, ventaNoVigente: true, hayAQuienComisionar: false, reservaAbierta: false }
  const plan = uno(venta.payment_plans)
  const pctAfiliado = Number(venta.affiliate_commission_percent)
  const candidatos = [
    venta.setter_id,
    venta.closer_id,
    // Un % ausente o 0 no es «alguien a quien comisionar» (el motor tampoco genera fila).
    venta.affiliate_id && Number.isFinite(pctAfiliado) && pctAfiliado > 0 ? venta.affiliate_id : null,
  ]
  return {
    id: fila.id,
    ventaNoVigente: !isActiveSale({ status: venta.status ?? '' }),
    hayAQuienComisionar: candidatos.some((u) => !!u && !exentos.has(u)),
    reservaAbierta: plan?.method === 'reserva' && !venta.reservation_completed_at,
  }
}
