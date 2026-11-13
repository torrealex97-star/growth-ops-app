// Lectura paginada para clientes PostgREST.
//
// PostgREST corta toda respuesta en `max_rows` (1000 en este proyecto, supabase/config.toml) pida lo
// que pida `.limit()`. Un `.limit(5000)` devolvía 1000 filas y el código daba la muestra por
// completa: cifras cortadas sin avisar. Aquí se pide por bloques con `.range()` hasta agotar o hasta
// un tope, y se devuelve SIEMPRE si la lectura quedó truncada para que quien pinta lo diga.

export const BLOQUE_FILAS = 1000

type Pagina<T> = { data: T[] | null; error: { message: string } | null }

export async function leerPaginado<T>(
  /** Debe aplicar un orden ESTABLE (con desempate) y `.range(desde, hasta)`. */
  pagina: (desde: number, hasta: number) => PromiseLike<Pagina<T>>,
  opciones: { max: number; bloque?: number }
): Promise<{ filas: T[]; truncado: boolean }> {
  const bloque = opciones.bloque ?? BLOQUE_FILAS
  const filas: T[] = []
  for (let desde = 0; ; desde += bloque) {
    const restante = opciones.max - filas.length
    if (restante <= 0) return { filas, truncado: true }
    const pedir = Math.min(bloque, restante)
    const { data, error } = await pagina(desde, desde + pedir - 1)
    if (error) throw new Error(error.message)
    const lote = data ?? []
    filas.push(...lote)
    // Un lote más corto que lo pedido es el final. Uno completo puede tener más detrás: se sigue,
    // y si lo que se agota es el tope, el siguiente giro lo declara truncado.
    if (lote.length < pedir) return { filas, truncado: false }
  }
}

export function trozos<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}
