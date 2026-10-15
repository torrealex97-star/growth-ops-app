// CONCILIACIÓN DE VISITAS: píxel propio frente a Meta.
//
// Dos instrumentos miden lo mismo (personas que llegan a la landing tras un clic): el pixel first-party
// (`page_view`) y Meta (`landing_page_view`). No coincidirán al 100 % —bloqueadores, salidas antes de
// cargar, páginas que no llevan el snippet—, pero si difieren MUCHO, uno de los dos está midiendo mal y
// cualquier conversión que se calcule sobre «visitas» miente. En vez de elegir uno en silencio, se
// comparan y se dice qué ha pasado. Puro: sin base de datos.

export type EstadoConciliacion = 'ok' | 'revisar' | 'critico' | 'muestra_baja' | 'sin_datos'

export type Conciliacion = {
  estado: EstadoConciliacion
  pixel: number | null
  meta: number | null
  /** pixel / meta. `null` si falta alguno de los dos o Meta es 0. */
  ratio: number | null
  /** Una frase accionable, sin jerga. */
  mensaje: string
}

/** Por debajo de esta cifra de Meta el cociente es ruido, no señal. */
export const MUESTRA_MINIMA_META = 30
/** Ratio a partir del cual los dos instrumentos se consideran de acuerdo. */
export const RATIO_OK = 0.7
/** Por debajo de esto, el píxel está perdiendo la mayoría del tráfico. */
export const RATIO_CRITICO = 0.4
/** Por encima, el píxel cuenta bastante más que Meta: recargas, bots o páginas ajenas al anuncio. */
export const RATIO_EXCESO = 1.3

const pct = (r: number) => `${Math.round(r * 100)} %`

export function conciliarVisitas(input: { pixel: number | null; meta: number | null }): Conciliacion {
  const { pixel, meta } = input
  if (pixel === null || meta === null) {
    return {
      estado: 'sin_datos',
      pixel,
      meta,
      ratio: null,
      mensaje: 'No se pueden comparar: falta la cifra del píxel o la de Meta en este periodo.',
    }
  }
  if (meta < MUESTRA_MINIMA_META) {
    return {
      estado: 'muestra_baja',
      pixel,
      meta,
      ratio: meta > 0 ? pixel / meta : null,
      mensaje: `Meta solo registra ${meta} visitas a la landing: muy poco para comparar con fiabilidad.`,
    }
  }
  const ratio = pixel / meta
  if (ratio < RATIO_CRITICO) {
    return {
      estado: 'critico',
      pixel,
      meta,
      ratio,
      mensaje: `El píxel recoge solo el ${pct(ratio)} de las visitas que cuenta Meta. Lo más probable: el snippet no está en la página a la que llevan los anuncios, o se carga después de que la persona se vaya. Hasta corregirlo, las conversiones calculadas sobre «visitas» salen infladas.`,
    }
  }
  if (ratio < RATIO_OK) {
    return {
      estado: 'revisar',
      pixel,
      meta,
      ratio,
      mensaje: `El píxel recoge el ${pct(ratio)} de lo que cuenta Meta. Una diferencia así es normal con bloqueadores de anuncios, pero conviene comprobar que todas las páginas del anuncio llevan el snippet.`,
    }
  }
  if (ratio > RATIO_EXCESO) {
    return {
      estado: 'revisar',
      pixel,
      meta,
      ratio,
      mensaje: `El píxel cuenta ${pct(ratio)} de lo que cuenta Meta: más visitas de las que mandan los anuncios (recargas, tráfico orgánico o de otras campañas). No es un fallo, pero no sirve para medir solo ads.`,
    }
  }
  return {
    estado: 'ok',
    pixel,
    meta,
    ratio,
    mensaje: `Píxel y Meta coinciden (${pct(ratio)}): la cifra de visitas es fiable.`,
  }
}
