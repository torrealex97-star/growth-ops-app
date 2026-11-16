/** Progreso de formación. Módulo puro: la API y el dashboard cuentan igual porque comparten esta función. */

export interface LeccionRef {
  id: string
  course_id: string
}

export interface ResumenProgreso {
  total: number
  hechas: number
  /** 0-100, entero. Sin lecciones → 0 (nunca NaN). */
  porcentaje: number
  porCurso: Record<string, { total: number; hechas: number }>
}

/**
 * `hechasIds` puede traer ids de lecciones ya borradas o de otra subcuenta: solo cuentan las que existen en
 * `lecciones`, para que el progreso nunca supere el 100 %.
 */
export function resumenProgreso(lecciones: readonly LeccionRef[], hechasIds: Iterable<string>): ResumenProgreso {
  const hechasSet = new Set(hechasIds)
  const porCurso: ResumenProgreso['porCurso'] = {}
  let hechas = 0
  for (const l of lecciones) {
    const c = (porCurso[l.course_id] ??= { total: 0, hechas: 0 })
    c.total += 1
    if (hechasSet.has(l.id)) {
      c.hechas += 1
      hechas += 1
    }
  }
  const total = lecciones.length
  return { total, hechas, porcentaje: total === 0 ? 0 : Math.round((hechas / total) * 100), porCurso }
}

/** Siguiente lección sin completar, en el orden dado (curso y posición ya ordenados por quien llama). */
export function siguientePendiente<T extends { id: string }>(
  ordenadas: readonly T[],
  hechasIds: Iterable<string>
): T | null {
  const hechasSet = new Set(hechasIds)
  return ordenadas.find((l) => !hechasSet.has(l.id)) ?? null
}
