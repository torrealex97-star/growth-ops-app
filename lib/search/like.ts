// BÚSQUEDA «CONTIENE» SEGURA PARA POSTGREST.
//
// Un texto escrito por una persona no puede ir tal cual dentro de `ilike.%…%` ni de un filtro `or()`:
//   · `%` y `_` son comodines de LIKE: buscar «a_b» encontraría «axb», y «100%» lo encontraría todo.
//   · `,`, `(`, `)` y `"` son la sintaxis de `or()` de PostgREST: «Gómez, Laura» rompía la consulta
//     entera y la búsqueda se quedaba sin resultados, sin error visible.
// Un único sitio que lo hace bien, para que ninguna pantalla vuelva a montar su propio patrón a mano.

/** Escapa los comodines de LIKE (`\`, `%`, `_`) para que se busquen como texto literal. */
export function escaparLike(valor: string): string {
  return valor.replace(/[\\%_]/g, '\\$&')
}

/** Quita lo que rompería la sintaxis de `or()` de PostgREST y colapsa los espacios. */
export function sinSintaxisOr(valor: string): string {
  return valor
    .replace(/[,()"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Patrón `%texto%` listo para `ilike`, tanto suelto como dentro de `or()`. Vacío si no queda texto. */
export function patronContiene(valor: string): string | null {
  const limpio = sinSintaxisOr(valor)
  return limpio ? `%${escaparLike(limpio)}%` : null
}
