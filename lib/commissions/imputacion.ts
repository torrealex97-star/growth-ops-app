// A QUÉ FECHA SE IMPUTA UNA COMISIÓN CUANDO UNA PANTALLA LA MIDE POR PERIODO.
//
// El libro de comisiones tiene TRES fechas y cada una responde a una pregunta distinta:
//   · cobro (`collections.collected_at`)  → «¿qué comisión generó el cash de este periodo?» (P&L, Resumen, Finanzas,
//                                            KPIs de rendimiento por persona). Principio de correlación: el coste de
//                                            la comisión va con el INGRESO que la generó.
//   · liquidación (`liquidation_month`)    → «¿qué se paga este mes?» (Comisiones, Mi día). Es el mes SIGUIENTE al cobro.
//   · creación (`created_at`)              → cuándo se escribió la fila. NO es una fecha de negocio: una reparación o un
//                                            ajuste la mueve (la reparación del 2-nov recreó filas de cobros de agosto
//                                            con fecha de creación de noviembre). Nunca se usa para medir un periodo.
//
// Esta función es la regla de «cobro» (la misma que usa el P&L): una sola definición para que Colaboradores y P&L
// cuenten lo mismo.
export type FilaImputable = {
  direction?: string | null
  collection_id: string | null
  liquidation_month?: string | null
  created_at?: string | null
}

export function fechaDeImputacion(
  c: FilaImputable,
  collectedAtById: Map<string, string | null | undefined>
): string | null {
  // Devoluciones (negativas): a su mes de liquidación (= mes de la devolución), como el P&L.
  if (c.direction === 'negative') return c.liquidation_month ?? c.created_at ?? null
  const cobro = c.collection_id ? collectedAtById.get(c.collection_id) : undefined
  // Sin cobro vinculado (ajuste manual, cuota aún sin cobrar): su mes de liquidación; la creación es el último recurso.
  return cobro ?? c.liquidation_month ?? c.created_at ?? null
}
