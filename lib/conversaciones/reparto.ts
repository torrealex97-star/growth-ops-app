// REPARTO ROUND-ROBIN (puro): a quién le toca la siguiente conversación sin responsable.
//
// Patrón de Chatwoot (asignación automática con tope justo), simplificado: gana quien tiene MENOS conversaciones
// vivas; a igualdad, quien lleva más tiempo sin recibir una; a igualdad total, el id (determinista, testeable).

export type Candidato = {
  id: string
  /** Conversaciones abiertas o pendientes ya asignadas a esta persona. */
  cargaViva: number
  /** Cuándo se le asignó la última (ISO) o null si nunca. */
  ultimaAsignacion: string | null
}

export function elegirResponsable(candidatos: readonly Candidato[], tope?: number): string | null {
  const validos = candidatos.filter((c) => tope === undefined || c.cargaViva < tope)
  if (!validos.length) return null
  const orden = validos.slice().sort((a, b) => {
    if (a.cargaViva !== b.cargaViva) return a.cargaViva - b.cargaViva
    const ua = a.ultimaAsignacion ?? ''
    const ub = b.ultimaAsignacion ?? ''
    if (ua !== ub) return ua < ub ? -1 : 1 // '' (nunca) va primero
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return orden[0].id
}
