import { DEFAULT_BRAND, type BrandConfig } from './types'

// ESTILOS que la persona elige en el proyecto. Cambian CÓMO se compone (cajas, titulares, velo de la foto, logo),
// nunca la identidad: colores, tipografías y logo salen siempre de la marca de la subcuenta.

type Estilo = {
  nombre: string
  descripcion: string
  /** Para qué productos se ofrece: historias (9:16), carruseles (feed) o ambos. */
  para: 'historias' | 'carrusel' | 'ambos'
  historias: string
  feed: string
}

export const ESTILOS = {
  nativo: {
    para: 'historias',
    nombre: 'Editor de Instagram',
    descripcion: 'Texto en cajas y marcador, como hecho en la propia app',
    historias:
      'Cajas de texto y una palabra marcada, como en el editor de la app: usa todas las plantillas, incluidos los stickers.',
    feed: 'Texto en cajas de fondo y una palabra marcada por slide, aspecto casero de creador, sin diseños recargados.',
  },
  editorial: {
    para: 'historias',
    nombre: 'Editorial',
    descripcion: 'Titulares grandes, una idea por pantalla y mucho aire',
    historias:
      'Titulares grandes y mucho aire, una sola idea por historia: prefiere portada, texto y cifra; evita los stickers salvo en el cierre.',
    feed: 'Titulares grandes y elegantes, una idea por slide, mucho espacio en blanco y fotos oscurecidas para dar contraste.',
  },
  limpio: {
    para: 'historias',
    nombre: 'Limpio',
    descripcion: 'La foto manda, texto mínimo',
    historias:
      'La foto manda con muy poco texto (máximo 12 palabras): prefiere portada y foto_texto; evita comparacion y cifra.',
    feed: 'La foto ocupa todo el lienzo con poco texto (máximo 12 palabras) sobre una franja translúcida; sin adornos.',
  },
  disenado: {
    para: 'carrusel',
    nombre: 'Diseñado',
    descripcion: 'Estructura llamativa: bloques, formas y tipografía grande',
    historias: '',
    feed: 'Diseño creativo y llamativo: composición con bloques de color, formas y tipografía enorme, jerarquía fuerte y un elemento gráfico por slide. Fondos de color o diseñados; las fotos solo donde aporten, no detrás de todas.',
  },
  foto: {
    para: 'carrusel',
    nombre: 'Con foto',
    descripcion: 'Foto a sangre detrás y texto encima',
    historias: '',
    feed: 'La foto ocupa todo el lienzo de cada slide con un velo para que el texto se lea; el texto va en bloques claros con jerarquía.',
  },
  minimal: {
    para: 'carrusel',
    nombre: 'Minimal',
    descripcion: 'Fondos de color liso y la tipografía como protagonista',
    historias: '',
    feed: 'Fondos de color liso de la marca, mucho aire y la tipografía como protagonista; sin fotos ni adornos, una idea por slide.',
  },
  marca: {
    para: 'ambos',
    nombre: 'De marca',
    descripcion: 'Colores, tipografía y logo de la marca al frente',
    historias:
      'La identidad manda: bloques con el color de la marca y su tipografía; la app pone el logo en todas las historias.',
    feed: 'La identidad manda: paleta estricta de la marca, tipografías de la marca, bloques de color de marca sobre la foto y el logo en todas las slides.',
  },
} as const satisfies Record<string, Estilo>

export type EstiloId = keyof typeof ESTILOS
export const ESTILO_IDS = Object.keys(ESTILOS) as EstiloId[]

/** Estilos que se ofrecen en cada producto. */
export const estilosDe = (esHistorias: boolean): EstiloId[] =>
  ESTILO_IDS.filter(
    (id) => ESTILOS[id].para === 'ambos' || ESTILOS[id].para === (esHistorias ? 'historias' : 'carrusel')
  )
export const estiloPorDefecto = (esHistorias: boolean): EstiloId => (esHistorias ? 'nativo' : 'disenado')

/** Un estilo válido PARA ese producto; si no lo es, el de por defecto. */
export const estiloValido = (v: unknown, esHistorias: boolean): EstiloId =>
  typeof v === 'string' && (estilosDe(esHistorias) as string[]).includes(v)
    ? (v as EstiloId)
    : estiloPorDefecto(esHistorias)

export type OpcionesEstilo = {
  estilo: EstiloId
  /** Usar las fotos subidas como fondo de las slides. En historias (9:16) siempre es así. */
  fotosDeFondo: boolean
}

const FUENTE_POR_DEFECTO = 'Inter'

/** ¿La marca tiene colores propios? Con los de fábrica, las historias salen con el azul genérico. */
export const marcaConColores = (brand: BrandConfig): boolean =>
  brand.colors.accent.toLowerCase() !== DEFAULT_BRAND.colors.accent.toLowerCase() ||
  brand.colors.primary.toLowerCase() !== DEFAULT_BRAND.colors.primary.toLowerCase()

/** Variables CSS con las tipografías de la marca, o null si la marca no tiene las suyas (se usa el estilo nativo). */
export function fuentesDeMarca(brand: BrandConfig): string | null {
  if (!brand.name) return null
  const { heading, body } = brand.fonts
  if (heading === FUENTE_POR_DEFECTO && body === FUENTE_POR_DEFECTO) return null
  return `--ig-f-titulo:'${heading}';--ig-f-cuerpo:'${body}'`
}

/** Sección del prompt con el estilo elegido, el uso de las fotos y el logo. */
export function seccionEstiloPrompt(p: {
  opciones: OpcionesEstilo
  esHistorias: boolean
  brand: BrandConfig
  fotos: { name: string; url: string }[]
}): string {
  const { opciones, esHistorias, brand, fotos } = p
  const e = ESTILOS[opciones.estilo]
  const lineas = [`## Estilo elegido: ${e.nombre}`, esHistorias ? e.historias : e.feed]

  if (!esHistorias && opciones.fotosDeFondo && fotos.length > 0) {
    lineas.push(
      `Usa las fotos subidas como FONDO a sangre de las slides (URL exacta): <div style="position:absolute;inset:0;background:url('URL') center/cover"></div>, con un velo (oscuro o del color de la marca) para que el texto se lea. Reparte las fotos entre las slides y repite solo si hay menos fotos que slides.`,
      ...fotos.map((f) => `- "${f.name}": ${f.url}`)
    )
  }

  if (!esHistorias && brand.logoUrl) {
    lineas.push(
      opciones.estilo === 'marca'
        ? `Logo de la marca (${brand.logoUrl}): ponlo pequeño (alto ~64px) en una esquina de TODAS las ${esHistorias ? 'historias' : 'slides'}, fuera de la zona de interfaz de la red.`
        : `Logo de la marca (${brand.logoUrl}): ponlo pequeño (alto ~64px) en una esquina de la primera y la última ${esHistorias ? 'historia' : 'slide'}.`
    )
  }

  const fuentes = esHistorias ? fuentesDeMarca(brand) : null
  if (fuentes) {
    lineas.push(
      `La marca tiene tipografías propias: añade ${fuentes} al style del contenedor ig-historia y NO uses ig-impacto ni ig-maquina (usan tipografías ajenas a la marca).`
    )
  }
  lineas.push('Mantén siempre colores, tipografías y logo de la marca; el estilo solo cambia la composición.')
  return lineas.join('\n')
}
