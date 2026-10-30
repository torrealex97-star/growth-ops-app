// NOTAS PRIVADAS DE UNA CONVERSACIÓN (puro): la parte que se puede probar sin BD — validar el texto y
// reconocer menciones «@Nombre» del mismo equipo.
//
// Una nota JAMÁS sale al lead (no pasa por `responder`): es comunicación interna sobre el fichero, con autor,
// marcable como fijada, y las menciones del texto solo se marcan si el @Nombre coincide con alguien
// del equipo (nada de menciones inventadas: en la nota queda texto plano; la mención es visual).

export const MAX_NOTA = 2000

/** Limpia el texto entrante y devuelve `null` si no es una nota válida (vacio o demasiado larga). */
export function limpiarNota(entrada: unknown): string | null {
  if (typeof entrada !== 'string') return null
  const texto = entrada.trim()
  if (!texto || texto.length > MAX_NOTA) return null
  return texto
}

export type MiembroEquipo = { id: string; nombre: string }
export type TokenNota = { texto: string; userId?: string }

/**
 * Reúne el texto en tokens y marca los `@Nombre` que coinciden (sin importar mayúsculas) con el nombre
 * COMPLETO de un miembro del equipo de gestión. Los nombres más largos ganan (evita que «Ana» coma
 * «Ana María»); el texto que no menciona queda intacto, troceado en tokens.
 */
export function mencionar(texto: string, equipo: readonly MiembroEquipo[]): { tokens: TokenNota[]; userIds: string[] } {
  const firma = equipo.filter((m) => m.nombre.trim() !== '').map((m) => ({ id: m.id, nombre: m.nombre.trim() }))
  if (!texto) return { tokens: [], userIds: [] }
  if (firma.length === 0) return { tokens: [{ texto }], userIds: [] }

  const escapado = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, ' ')
  // Los nombres más largos primero para que «Ana María» gane sobre «Ana».
  firma.sort((a, b) => b.nombre.length - a.nombre.length)
  const porNombre = new Map(firma.map((m) => [m.nombre.toLowerCase(), m]))
  const re = new RegExp(`@(?:${firma.map((m) => escapado(m.nombre)).join('|')})`, 'gi')

  const tokens: TokenNota[] = []
  const userIds: string[] = []
  let desde = 0
  for (const match of texto.matchAll(re)) {
    const i = match.index ?? 0
    if (i > desde) tokens.push({ texto: texto.slice(desde, i) })
    // `match` viene del texto: la coincidencia con el nombre es por minúsculas, no por tal cual.
    const fragmento = texto
      .slice(i, i + match[0].length)
      .slice(1)
      .toLowerCase()
    const quien = porNombre.get(fragmento)
    tokens.push({ texto: texto.slice(i, i + match[0].length), userId: quien?.id })
    if (quien && !userIds.includes(quien.id)) userIds.push(quien.id)
    desde = i + match[0].length
  }
  if (desde < texto.length) tokens.push({ texto: texto.slice(desde) })
  return { tokens, userIds }
}
