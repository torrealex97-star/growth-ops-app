// RESUMEN MES A MES de comisiones: cuánto hay por cobrar cada mes, cuánto viene de VENTA NUEVA y cuánto
// de RECURRENCIA, y quién (persona + cliente) está detrás de cada importe.
//
// Lógica PURA (sin Supabase ni React) para poder congelarla con un test.
//
// Definiciones (no se inventan aquí; son las canónicas del repo):
//  · NUEVA = comisión del PRIMER cobro recogido de su venta; RECURRENTE = cualquier cobro posterior.
//    Misma semántica que `clasificarCobrosPorMes` / `tipoDeCuotaFutura` (lib/finance/nuevo-vs-recurrente):
//    decide la fecha de COBRO, no la de la venta. Para las filas ya generadas se infiere del cobro que
//    originó la comisión; para las futuras ya viene resuelto (`FilaFutura.tipo`).
//  · AJUSTE = devoluciones (direction='negative') y filas manuales sin cobro. No son ni nueva ni
//    recurrente: se muestran aparte para que el total cuadre con la tabla de comisiones.
//  · Cada mes es el MES DE PAGO (liquidación): lo que el cliente abona en octubre se cobra en noviembre
//    (regla del motor: calculator.getLiquidationMonth). Comisión generada = `liquidation_month || created_at`;
//    comisión futura = mes SIGUIENTE al vencimiento de la cuota.
//  · Las exentas (`pays_commissions=false`, D9) y las canceladas NUNCA suman. Las cuotas VENCIDAS sin cobrar
//    (impagos) tampoco entran en ningún mes: se devuelven aparte con `impagosVencidos`.
//  · Una cuota futura es una PREVISIÓN sujeta a cobro (D7): suma al "por cobrar" pero se marca aparte.
import type { CommissionDashboardRow } from '@/lib/commissions/dashboard'
import type { FilaFutura } from '@/lib/commissions/future-response'
import type { ParticipantType } from '@/lib/types/database'

export type TipoComision = 'nuevo' | 'recurrente' | 'ajuste'

export type ClienteComision = { saleId: string | null; contact: string; amount: number }

export type PersonaComision = {
  userId: string
  name: string
  participantType: ParticipantType
  amount: number
  /** Parte de `amount` que aún es previsión (cuota sin cobrar). */
  prevista: number
  clientes: ClienteComision[]
}

export type GrupoComision = {
  amount: number
  prevista: number
  personas: PersonaComision[]
}

export type MesComision = {
  /** YYYY-MM */
  month: string
  nuevo: GrupoComision
  recurrente: GrupoComision
  ajuste: GrupoComision
  /** nuevo + recurrente + ajuste (incluye previsión). */
  total: number
  /** Ya liquidado (pagado). */
  pagado: number
  /** total − pagado: lo que falta por cobrar la gente. */
  porCobrar: number
  /** Parte del total que todavía es previsión sujeta a cobro. */
  prevista: number
}

const signed = (row: CommissionDashboardRow) =>
  Number(row.commission_amount || 0) * (row.direction === 'negative' ? -1 : 1)

export function claveMes(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Mes (YYYY-MM) en que se paga la comisión de un cobro realizado en `fecha`: el mes siguiente. '' si no se lee. */
export function mesDePago(fecha: string | null | undefined): string {
  const y = Number(String(fecha ?? '').slice(0, 4))
  const m = Number(String(fecha ?? '').slice(5, 7))
  if (!y || !m || m < 1 || m > 12) return ''
  const d = new Date(Date.UTC(y, m, 1)) // `m` es 1-12: usado como índice de mes = el SIGUIENTE
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Primer cobro recogido por venta (ISO), a partir de las comisiones positivas que lo originaron. */
export function primerCobroPorVenta(rows: CommissionDashboardRow[]): Map<string, string> {
  const primeros = new Map<string, string>()
  for (const row of rows) {
    if (row.direction === 'negative' || row.status === 'cancelled') continue
    const at = row.collections?.collected_at
    if (!row.sale_id || !row.collection_id || !at) continue
    const previo = primeros.get(row.sale_id)
    if (!previo || at < previo) primeros.set(row.sale_id, at)
  }
  return primeros
}

export function tipoDeComision(row: CommissionDashboardRow, primeros: Map<string, string>): TipoComision {
  if (row.direction === 'negative' || !row.collection_id || !row.sale_id) return 'ajuste'
  const at = row.collections?.collected_at
  // Sin fecha de cobro legible no se puede probar que sea el primero: no se presenta como venta nueva.
  if (!at) return 'recurrente'
  return primeros.get(row.sale_id) === at ? 'nuevo' : 'recurrente'
}

const grupoVacio = (): GrupoComision => ({ amount: 0, prevista: 0, personas: [] })

const mesVacio = (month: string): MesComision => ({
  month,
  nuevo: grupoVacio(),
  recurrente: grupoVacio(),
  ajuste: grupoVacio(),
  total: 0,
  pagado: 0,
  porCobrar: 0,
  prevista: 0,
})

function sumar(
  grupo: GrupoComision,
  persona: { userId: string; name: string; participantType: ParticipantType },
  cliente: { saleId: string | null; contact: string },
  amount: number,
  prevista: boolean
) {
  grupo.amount += amount
  if (prevista) grupo.prevista += amount
  let p = grupo.personas.find((x) => x.userId === persona.userId && x.participantType === persona.participantType)
  if (!p) {
    p = { ...persona, amount: 0, prevista: 0, clientes: [] }
    grupo.personas.push(p)
  }
  p.amount += amount
  if (prevista) p.prevista += amount
  let c = p.clientes.find((x) => x.saleId === cliente.saleId && x.contact === cliente.contact)
  if (!c) {
    c = { ...cliente, amount: 0 }
    p.clientes.push(c)
  }
  c.amount += amount
}

/**
 * @param rows        comisiones a resumir (ya acotadas por persona/tipo/búsqueda; NUNCA por fecha).
 * @param future      cuotas por cobrar (ya acotadas igual). Las `exento` se ignoran.
 * @param basis       todas las comisiones visibles, para decidir cuál fue el primer cobro de cada venta
 *                    aunque la fila del primer cobro haya quedado fuera del acotado por persona.
 * @param now         se asegura que el mes en curso aparezca siempre, aunque esté vacío.
 */
export function construirResumenMensual(
  rows: CommissionDashboardRow[],
  future: FilaFutura[],
  basis: CommissionDashboardRow[] = rows,
  now = new Date()
): MesComision[] {
  const meses = new Map<string, MesComision>()
  const mes = (key: string) => {
    let m = meses.get(key)
    if (!m) {
      m = mesVacio(key)
      meses.set(key, m)
    }
    return m
  }
  mes(claveMes(now))

  const primeros = primerCobroPorVenta(basis)

  for (const row of rows) {
    if (row.status === 'cancelled') continue
    const key = String(row.liquidation_month || row.created_at || '').slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(key)) continue
    const amount = signed(row)
    const m = mes(key)
    const tipo = tipoDeComision(row, primeros)
    sumar(
      m[tipo],
      {
        userId: row.user_id,
        name: row.users?.full_name || 'Sin nombre',
        participantType: row.participant_type,
      },
      { saleId: row.sale_id ?? null, contact: row.sales?.contacts?.full_name || 'Sin contacto' },
      amount,
      false
    )
    if (row.status === 'liquidated') m.pagado += amount
  }

  for (const f of future) {
    if (f.exento) continue
    // Cuota VENCIDA sin cobrar = impago: no es dinero que vaya a llegar en ningún mes concreto.
    // Se cuenta aparte (`impagosVencidos`), igual que hace el dashboard del colaborador.
    if (f.estado === 'overdue') continue
    // La comisión de un cobro SE PAGA el mes siguiente (calculator.getLiquidationMonth): igual que las ya generadas.
    const key = mesDePago(f.dueDate)
    if (!/^\d{4}-\d{2}$/.test(key)) continue
    const amount = Number(f.amount || 0)
    if (!amount) continue
    sumar(
      mes(key)[f.tipo],
      { userId: f.userId, name: f.userName || 'Sin nombre', participantType: f.participantType },
      { saleId: f.saleId, contact: f.contact || 'Sin contacto' },
      amount,
      true
    )
  }

  const out = [...meses.values()].sort((a, b) => a.month.localeCompare(b.month))
  for (const m of out) {
    m.total = m.nuevo.amount + m.recurrente.amount + m.ajuste.amount
    m.prevista = m.nuevo.prevista + m.recurrente.prevista + m.ajuste.prevista
    m.porCobrar = m.total - m.pagado
    for (const g of [m.nuevo, m.recurrente, m.ajuste]) {
      g.personas.sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
      for (const p of g.personas) p.clientes.sort((a, b) => b.amount - a.amount || a.contact.localeCompare(b.contact))
    }
  }
  return out
}

/** Comisión proyectada de cuotas VENCIDAS sin cobrar al cliente: no llega hasta que pague. No suma en ningún mes. */
export function impagosVencidos(future: FilaFutura[]): number {
  return future.reduce((acc, f) => (!f.exento && f.estado === 'overdue' ? acc + Number(f.amount || 0) : acc), 0)
}
