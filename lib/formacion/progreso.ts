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

/**
 * Orden ÚNICO de lecciones (por curso en su orden y luego por posición, con desempate estable por id). La pantalla
 * de formación y la tarjeta del dashboard lo comparten para coincidir siempre en cuál es «la siguiente».
 */
export function ordenarLecciones<T extends { id: string; course_id: string; position: number }>(
  cursos: readonly { id: string }[],
  lecciones: readonly T[]
): T[] {
  const ordenCurso = new Map(cursos.map((c, i) => [c.id, i]))
  return [...lecciones].sort(
    (a, b) =>
      (ordenCurso.get(a.course_id) ?? Number.MAX_SAFE_INTEGER) -
        (ordenCurso.get(b.course_id) ?? Number.MAX_SAFE_INTEGER) ||
      a.position - b.position ||
      a.id.localeCompare(b.id)
  )
}

/**
 * ¿Ve este rol el curso? Público vacío o ausente = todo el equipo. Quien administra la subcuenta ve todos
 * (para poder gestionarlos), y se resuelve fuera de aquí.
 */
export function cursoVisibleParaRol(audienceRoles: readonly string[] | null | undefined, rol: string | null): boolean {
  if (!audienceRoles || audienceRoles.length === 0) return true
  return !!rol && audienceRoles.includes(rol)
}
