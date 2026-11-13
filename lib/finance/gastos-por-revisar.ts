// GASTOS POR REVISAR QUE EL FILTRO DE PERIODO ESCONDE.
//
// La pantalla de Gastos filtra por `expense_date`. La factura de un colaborador se fecha en su MES DE PAGO
// (lo generado en un mes se paga el siguiente, ver lib/commissions/invoice-expense.ts), así que la factura
// del mes en curso nace con fecha del mes que viene: llegaba a Gastos con «Revisar»… en un mes que nadie
// estaba mirando. La bandeja de revisión no puede depender de la fecha contable: lo pendiente de revisar se
// muestra SIEMPRE, marcado como fuera del periodo, sin sumarse a los totales del periodo.

import { inPeriod, type PeriodRange } from '@/lib/filters/period'

type GastoRevisable = { needs_review?: boolean | null; expense_date: string }

/** Gastos con revisión pendiente cuya fecha queda FUERA del periodo elegido (los de dentro ya se ven). */
export function porRevisarFueraDelPeriodo<T extends GastoRevisable>(items: T[], rango: PeriodRange): T[] {
  return items.filter((e) => e.needs_review === true && !inPeriod(e.expense_date, rango))
}
