import { CATEGORIAS, longitudValida, type CategoriaId, type LongitudSecuencia } from './categorias'

// Encargo inicial de una secuencia de historias: lo que se elige al crear el proyecto (categoría,
// longitud y tema) convertido en el primer mensaje al agente. Puro y sin red.

export const LONGITUDES: readonly LongitudSecuencia[] = [3, 5, 7]
/** `auto` = que el agente elija la categoría que mejor encaje con el tema. */
export type CategoriaElegida = CategoriaId | 'auto'

export const OPCIONES_CATEGORIA: { id: CategoriaElegida; label: string }[] = [
  { id: 'auto', label: 'Elige la que mejor encaje' },
  ...Object.values(CATEGORIAS).map((c) => ({ id: c.id, label: c.label })),
]

export const MAX_TEMA = 600

export type EncargoHistorias = {
  categoria: CategoriaElegida
  longitud: number | null | undefined
  tema: string
}

/** Primer mensaje al agente. Lanza si la categoría no existe; recorta el tema y normaliza la longitud. */
export function mensajeInicial(e: EncargoHistorias): string {
  if (e.categoria !== 'auto' && !CATEGORIAS[e.categoria])
    throw new Error(`Categoría de historias desconocida: ${e.categoria}`)
  const n = longitudValida(e.longitud)
  const tema = e.tema.replace(/\s+/g, ' ').trim().slice(0, MAX_TEMA)
  const categoria =
    e.categoria === 'auto'
      ? 'Elige tú la categoría que mejor encaje con el tema.'
      : `Categoría: ${CATEGORIAS[e.categoria].label} (${e.categoria}).`
  return [
    `Crea una secuencia de ${n} historias.`,
    categoria,
    tema ? `Tema: ${tema}` : 'Tema: propón el que mejor encaje con mi negocio y mi audiencia.',
    'Usa mis fotos subidas en el orden que mejor sirva al arco (gancho con la más luminosa, cierre con la más cálida) y respeta el estilo del editor nativo.',
  ].join('\n')
}
