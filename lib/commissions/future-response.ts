// CONTRATO DIVIDIDO (un hueco no es un cero) de GET /api/[tenant]/evergreen/commissions/future:
// la ruta contesta { ok: true, rows, total, desgloseNuevoVsRecurrente } con 200 y
// { error: string } con 500. En los consumidores de UI es tentador mirar solo `d?.rows`:
// un 500 llega por el mismo .then((r) => r.json()) y codificaría el fallo como «vacío»,
// pintando comisiones futuras 0 EUR (parece que no hay nada por cobrar) — el bug de la
// S1 §6.8 confirmado con captura en pantalla y corregido en la página de comisiones,
// el dashboard y ColaboradorDashboard (14-oct). La interpretación del contrato vive aquí
// una sola vez; el fallo se respira VISIBLE (aviso + reintentar), cantidad falsa nunca// (regla #272 «un error de carga no es un estado vacío»). El tipo de fila también es canónico:
// duplica la Row de la ruta (fuente única: app/api/[tenant]/evergreen/commissions/future).
export type FilaFutura = {
  installmentId: string
  saleId: string
  contact: string
  dueDate: string
  userId: string
  userName: string
  participantType: 'setter' | 'closer' | 'affiliate'
  base: number
  percent: number
  amount: number
  source: 'installment' | 'review'
  estado: 'pending' | 'overdue' | 'review'
  collectionId?: string
  /** NUEVO = será el primer cobro de una venta que aún no cobró; RECURRENTE = cuota del
   * plan de una venta que ya cobró (MRR). Canónico: lib/finance/nuevo-vs-recurrente. */
  tipo: 'nuevo' | 'recurrente'
  /** Exenta (users.pays_commissions=false): la fila se lista con importe 0 — nunca
   * se sumará en totales ni se convertirá en fila del motor. */
  exento?: boolean
}

export function interpretarRespuestaFuturas(d: unknown): { rows: FilaFutura[] } | { error: string } {
  const r = d as { ok?: boolean; rows?: unknown[]; error?: unknown } | null
  if (r?.ok && Array.isArray(r.rows)) return { rows: r.rows as FilaFutura[] }
  return { error: typeof r?.error === 'string' ? r.error : 'respuesta ilegible del servidor' }
}
