// Presupuesto de tiempo de un cron multi-tenant, canónico para todas las rutas cron/*.
//
// Lecciones de producción codificadas (AGENTS.md / FREE_TIER_OPERATIONS §Cadencia):
//   · El presupuesto es GLOBAL por invocación: cold start, config, candados y margen de
//     respuesta ya se comen parte del `maxDuration` de Vercel; el corte por presupuesto NO
//     es un fallo y la pasada siguiente continúa con upsert idempotente.
//   · El reparto anterior (reminders/monthly/analyze-calls/reels) calculaba
//     `Date.now() + presupuesto/n` EN CADA iteración: el deadline de la subcuenta i-ésima
//     se extendía por el reloj del momento y el peor caso global era `n × presupuesto`, no
//     el presupuesto global (con dos tenants es mudo; a escala, noisy-neighbor + 504).
//     Aquí el reparto queda ANCLADO al `stopAt` del run: la cuota de cada subcuenta es
//     `min(stopAt, franja + cuota)` y la suma de peores casos nunca supera el presupuesto.
//
// Módulo PURO y determinista: el reloj va inyectado; sin BD, sin red, sin LLM.

export type CuotaSubcuenta = {
  /** Deadline absoluto (ms epoch) para esta subcuenta. Corte declarado, no error. */
  deadlineMs: number
  /** Cuota nominal asignada (ms). Lo que no se consume queda disponible para el run completo. */
  cuotaMs: number
}

export type PresupuestoCron = {
  /** Instante en el que TODO el trabajo debe parar (ms epoch). */
  stopAt: number
  /** Cuotas en el mismo orden en que se recorren las subcuentas (fair-share igual). */
  cuotas: CuotaSubcuenta[]
}

/**
 * Reparte `presupuestoMs` desde `nowMs` entre `nItems` trabajos con fair-share igual,
 * ANCLADO a un único deadline global.
 *   · nItems ≤ 0 ⇒ presupuesto global intacto, sin cuotas (no hay a quien repartir).
 *   · La cuota es igual para todos; una subcuenta rápida no infla la de la siguiente.
 */
export function crearPresupuestoCron(presupuestoMs: number, nowMs: number, nItems: number): PresupuestoCron {
  if (!Number.isFinite(presupuestoMs) || presupuestoMs <= 0)
    throw new Error('presupuestoMs debe ser un número de milisegundos positivo')
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new Error('nowMs debe ser un epoch válido')
  const n = Math.trunc(nItems)
  if (!Number.isFinite(n) || n < 0) throw new Error('nItems debe ser un entero >= 0')
  const stopAt = nowMs + presupuestoMs
  const cuotas: CuotaSubcuenta[] = []
  if (n === 0) return { stopAt, cuotas }
  const cuotaMs = presupuestoMs / n
  for (let i = 0; i < n; i++) {
    const franja = nowMs + i * cuotaMs
    const deadlineMs = Math.min(stopAt, franja + cuotaMs)
    cuotas.push({ deadlineMs, cuotaMs })
  }
  return { stopAt, cuotas }
}

/** true si el margen de la cuota ya se agotó: el corte se DECLARA, nunca se lanza como error. */
export function cuotaAgotada(deadlineMs: number, nowMs: number): boolean {
  return nowMs >= deadlineMs
}
