import type { BrandConfig } from '../types'
import { SEGURA_POR_PLATAFORMA, type Plataforma } from './estilo-nativo'
import { fuentesDeMarca, type EstiloId } from '../estilos'
import { fechaEtiqueta } from './fecha'
import { TIPOS_PEDIDO, esTipoPedido, limpiarClave, type Pedido } from './pedidos'
import { FUENTES_IG, type FuenteIg } from './fuentes-ig'
import { capturaHtml, corta, esc, stickerHtml } from './html-util'
import { estiloFondoPos, leerCapas, leerFondoPos, renderCapas, type Capa, type FondoPos } from './capas'

export { FUENTES_IG, type FuenteIg }

// PLANTILLAS DE HISTORIA: el código, no la IA, decide dónde va cada cosa. La IA elige el tipo de historia y
// el texto; aquí se decide si va foto limpia, foto oscurecida o fondo liso, y se colocan fecha, logo, titular
// y stickers en zonas que no se pisan (cabecera arriba; el contenido, en una columna dentro de la zona segura).
// Todo texto se escapa y se acota para que nunca desborde ni inyecte HTML.

export const LAYOUTS = [
  'portada',
  'texto',
  'foto_texto',
  'comparacion',
  'sticker',
  'cifra',
  'partida',
  'captura',
] as const
export type Layout = (typeof LAYOUTS)[number]

export type Medio = { url: string; kind: 'image' | 'video'; name: string }

export type HistoriaSpec = {
  layout: Layout
  titulo?: string
  /** Palabra o frase del titular que se resalta con el color de la marca. */
  acento?: string
  texto?: string
  /** Para «comparacion»: hasta 2 recuadros (p. ej. ❌ antes / ✅ ahora). */
  items?: { icono?: string; titulo: string; texto?: string }[]
  /** Para «sticker». */
  sticker?: { tipo: 'pregunta' | 'escribe'; cabecera?: string; texto?: string }
  /** Para «cifra»: el número o dato grande. */
  cifra?: string
  /** Etiqueta de fecha arriba a la izquierda (por defecto, solo en la primera historia). */
  fecha?: boolean
  /** Número (desde 1) de la foto o vídeo a usar; sin él se elige solo. */
  foto?: number
  /** Para «captura»: el material real que hace falta (captura de pago, testimonio…). */
  pedido?: Pedido
  /** Tipografía del texto, como las del editor de Instagram. */
  fuente?: FuenteIg
  /** Fondo del texto: sin caja, caja sólida o caja translúcida (como el botón «A» del editor). */
  fondoTexto?: 'sin' | 'solido' | 'translucido'
  /** Color de la caja de texto. */
  colorTexto?: 'blanco' | 'negro' | 'marca'
  /** Posición vertical del bloque de texto (0 = arriba, 100 = abajo), p. ej. al arrastrarlo. Sin ella, la de la plantilla. */
  posicion?: number
  /** Red donde se publica: cambia los márgenes de la interfaz que hay que respetar. Por defecto, Instagram. */
  plataforma?: Plataforma
  /** Historia de cierre: lleva el logo. */
  ultima?: boolean
  /** Segunda foto para «partida». */
  foto2?: number
  /** Fondo liso de la marca en vez de foto (para dar respiro entre fotos). */
  fondo?: 'foto' | 'liso'
  /** Encuadre de la foto de fondo: punto de enfoque (0-100) y zoom (1-3). Sin él, centrada y a tamaño completo. */
  fondoPos?: FondoPos
  /** Oscurecimiento de la foto (0-90 %). Sin él, el de la plantilla. */
  velo?: number
  /**
   * MODO LIBRE: lista de elementos colocados a mano (texto, fotos, emojis, stickers, formas). Si existe (aunque esté vacía),
   * la historia se compone con ellos en vez de con la plantilla; `titulo`/`texto` se conservan para la revisión de la secuencia.
   */
  capas?: Capa[]
}

export type ContextoRender = {
  brand: BrandConfig
  estilo: EstiloId
  media: Medio[]
  hoy: Date
  /** Imágenes reales ya subidas para los pedidos, por clave. */
  pedidos?: Record<string, string>
  /** Posición de esta historia en la secuencia (desde 0) y total. */
  indice: number
  total: number
}

// ── Validación de lo que manda la IA
export function leerSpec(entrada: unknown): { ok: true; spec: HistoriaSpec } | { ok: false; error: string } {
  const b = (entrada && typeof entrada === 'object' ? entrada : {}) as Record<string, unknown>
  if (!(LAYOUTS as readonly string[]).includes(String(b.layout)))
    return { ok: false, error: `layout debe ser uno de: ${LAYOUTS.join(', ')}` }
  const txt = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? corta(v.trim(), n) : undefined)
  const num = (v: unknown) => (Number.isInteger(v) && (v as number) >= 1 ? (v as number) : undefined)
  const spec: HistoriaSpec = {
    layout: b.layout as Layout,
    titulo: txt(b.titulo, 110),
    acento: txt(b.acento, 40),
    texto: txt(b.texto, 240),
    cifra: txt(b.cifra, 14),
    fecha: typeof b.fecha === 'boolean' ? b.fecha : undefined,
    ultima: b.ultima === true ? true : undefined,
    plataforma: b.plataforma === 'tiktok' ? 'tiktok' : undefined,
    posicion:
      typeof b.posicion === 'number' && Number.isFinite(b.posicion)
        ? Math.min(94, Math.max(6, Math.round(b.posicion)))
        : undefined,
    fuente: (FUENTES_IG as readonly unknown[]).includes(b.fuente) ? (b.fuente as FuenteIg) : undefined,
    fondoTexto:
      b.fondoTexto === 'sin' || b.fondoTexto === 'solido' || b.fondoTexto === 'translucido' ? b.fondoTexto : undefined,
    colorTexto:
      b.colorTexto === 'blanco' || b.colorTexto === 'negro' || b.colorTexto === 'marca' ? b.colorTexto : undefined,
    foto: num(b.foto),
    foto2: num(b.foto2),
    fondo: b.fondo === 'liso' || b.fondo === 'foto' ? b.fondo : undefined,
    fondoPos: leerFondoPos(b.fondoPos),
    velo:
      typeof b.velo === 'number' && Number.isFinite(b.velo) ? Math.min(90, Math.max(0, Math.round(b.velo))) : undefined,
    capas: Array.isArray(b.capas) ? leerCapas(b.capas) : undefined,
  }
  if (Array.isArray(b.items))
    spec.items = b.items
      .slice(0, 2)
      .map((i) => {
        const o = (i && typeof i === 'object' ? i : {}) as Record<string, unknown>
        return { icono: txt(o.icono, 4), titulo: txt(o.titulo, 40) ?? '', texto: txt(o.texto, 120) }
      })
      .filter((i) => i.titulo)
  const s = (b.sticker && typeof b.sticker === 'object' ? b.sticker : null) as Record<string, unknown> | null
  if (s && (s.tipo === 'pregunta' || s.tipo === 'escribe'))
    spec.sticker = { tipo: s.tipo, cabecera: txt(s.cabecera, 30), texto: txt(s.texto, 120) }
  const p = (b.pedido && typeof b.pedido === 'object' ? b.pedido : null) as Record<string, unknown> | null
  if (p && esTipoPedido(p.tipo) && limpiarClave(p.clave))
    spec.pedido = {
      clave: limpiarClave(p.clave),
      tipo: p.tipo,
      titulo: txt(p.titulo, 80) ?? TIPOS_PEDIDO[p.tipo].etiqueta,
    }
  // Modo libre: lo que se ve son las capas (puede ser solo una foto, sin texto); las exigencias por plantilla no aplican.
  if (spec.capas) return { ok: true, spec }
  if (spec.layout === 'captura' && !spec.pedido)
    return { ok: false, error: 'captura necesita el campo pedido {clave, tipo, titulo}' }
  if (spec.layout === 'comparacion' && !spec.items?.length) return { ok: false, error: 'comparacion necesita items' }
  if (spec.layout === 'sticker' && !spec.sticker) return { ok: false, error: 'sticker necesita el campo sticker' }
  if (spec.layout === 'cifra' && !spec.cifra) return { ok: false, error: 'cifra necesita el campo cifra' }
  if (!spec.titulo && !spec.texto && !spec.items?.length && !spec.sticker && !spec.cifra && !spec.pedido)
    return { ok: false, error: 'la historia no tiene ningún texto' }
  return { ok: true, spec }
}

/** Cambia de plantilla rellenando lo que la nueva exige (para que el cambio desde el editor siempre sea válido). */
export function conLayout(spec: HistoriaSpec, layout: Layout): HistoriaSpec {
  const siguiente: HistoriaSpec = { ...spec, layout }
  if (layout === 'comparacion' && !siguiente.items?.length)
    siguiente.items = [
      { icono: '❌', titulo: 'Antes' },
      { icono: '✅', titulo: 'Ahora' },
    ]
  if (layout === 'sticker' && !siguiente.sticker) siguiente.sticker = { tipo: 'escribe', cabecera: 'ESCRIBE AQUÍ' }
  if (layout === 'cifra' && !siguiente.cifra) siguiente.cifra = '100%'
  if (layout === 'captura' && !siguiente.pedido)
    siguiente.pedido = { clave: 'material', tipo: 'otro', titulo: TIPOS_PEDIDO.otro.etiqueta }
  if (
    !siguiente.titulo &&
    !siguiente.texto &&
    !siguiente.items?.length &&
    !siguiente.sticker &&
    !siguiente.cifra &&
    !siguiente.pedido
  )
    siguiente.texto = 'Escribe aquí'
  return siguiente
}

// ── Color
function luminancia(hex: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const esOscuro = (hex: string) => (luminancia(hex) ?? 0) < 0.45

/** Fondo liso: el color más oscuro de la marca, o un casi negro. */
export function fondoLiso(brand: BrandConfig): string {
  return [brand.colors.primary, brand.colors.secondary].find((c) => c && esOscuro(c)) ?? '#111318'
}

// ── Velo (oscurecimiento de la foto) por tipo de historia
const ESCALA = [0, 20, 40, 60, 75] as const
const VELO_BASE: Record<Layout, number> = {
  portada: 20,
  texto: 75,
  foto_texto: 40,
  comparacion: 75,
  sticker: 60,
  cifra: 75,
  partida: 40,
  captura: 75,
}
export function veloDe(layout: Layout, estilo: EstiloId): number {
  const i = ESCALA.indexOf(VELO_BASE[layout] as (typeof ESCALA)[number])
  if (estilo === 'limpio') return ESCALA[Math.max(0, i - 1)]
  if (estilo === 'editorial' && layout === 'foto_texto') return 60
  return ESCALA[i]
}

// ── Elección de foto
export function elegirMedio(spec: HistoriaSpec, ctx: ContextoRender, ordinal: 1 | 2 = 1): Medio | null {
  const { media } = ctx
  if (!media.length) return null
  const pedido = ordinal === 1 ? spec.foto : spec.foto2
  if (pedido && media[pedido - 1]) return media[pedido - 1]
  if (spec.layout === 'portada' && ctx.indice === 0 && ordinal === 1)
    return media.find((m) => m.kind === 'video') ?? media[0]
  return media[(ctx.indice + (ordinal - 1)) % media.length]
}

function medioHtml(m: Medio, pos?: FondoPos): string {
  const estilo = pos ? ` style="${esc(estiloFondoPos(pos))}"` : ''
  return m.kind === 'video'
    ? `<video class="ig-foto"${estilo} src="${esc(m.url)}" muted loop autoplay playsinline crossorigin="anonymous"></video>`
    : `<img class="ig-foto"${estilo} src="${esc(m.url)}" alt="">`
}

// ── Texto
function tituloHtml(spec: HistoriaSpec, estilo: EstiloId): string {
  const t = spec.titulo
  if (!t) return ''
  const clase = estilo === 'editorial' || estilo === 'limpio' ? 'ig-acento' : 'ig-marcador'
  let cuerpo = esc(t)
  const a = spec.acento
  const i = a ? t.toLowerCase().indexOf(a.toLowerCase()) : -1
  if (a && i >= 0)
    cuerpo = `${esc(t.slice(0, i))}<span class="${clase}">${esc(t.slice(i, i + a.length))}</span>${esc(t.slice(i + a.length))}`
  const px = t.length <= 40 ? 112 : t.length <= 70 ? 92 : 76
  return `<div class="ig-titulo" style="font-size:${estilo === 'limpio' ? Math.round(px * 0.8) : px}px">${cuerpo}</div>`
}

function bloqueTexto(texto: string | undefined, estilo: EstiloId, spec: HistoriaSpec): string {
  if (!texto) return ''
  const t = esc(texto)
  if (spec.fondoTexto) {
    if (spec.fondoTexto === 'sin') return `<div class="ig-texto">${t}</div>`
    const c = spec.colorTexto ?? 'blanco'
    const clase =
      spec.fondoTexto === 'solido'
        ? c === 'negro'
          ? 'ig-caja-solida-negra'
          : c === 'marca'
            ? 'ig-caja-acento'
            : 'ig-caja'
        : c === 'blanco'
          ? 'ig-caja-vidrio'
          : 'ig-caja-negra'
    return `<div><span class="${clase}">${t}</span></div>`
  }
  if (estilo === 'editorial') return `<div class="ig-texto">${t}</div>`
  if (estilo === 'limpio') return `<div class="ig-franja"><span class="ig-texto">${t}</span></div>`
  return `<div><span class="${estilo === 'marca' ? 'ig-caja-acento' : 'ig-caja-negra'}">${t}</span></div>`
}

const recuadro = (i: NonNullable<HistoriaSpec['items']>[number]) =>
  `<div class="ig-recuadro"><b>${i.icono ? `${esc(i.icono)} ` : ''}${esc(i.titulo)}</b>${esc(i.texto ?? '')}</div>`

/** Alto mínimo (px) que se deja al bloque de texto al colocarlo abajo del todo. */
export const ALTO_MINIMO_BLOQUE = 200

/** Altura (px) del BORDE SUPERIOR del bloque de texto para una posición 0-100: siempre debajo de la cabecera y dentro de la zona segura. */
export const posicionPx = (p: number, plataforma: Plataforma = 'instagram'): number => {
  const z = SEGURA_POR_PLATAFORMA[plataforma]
  return Math.round(z.arriba + (p / 100) * (1920 - z.arriba - z.abajo - ALTO_MINIMO_BLOQUE))
}

// ── Composición
export function renderHistoria(spec: HistoriaSpec, ctx: ContextoRender): string {
  const { brand, estilo } = ctx
  // «partida» necesita dos medios; con menos, se compone como foto con texto.
  const layout: Layout = spec.layout === 'partida' && ctx.media.length < 2 ? 'foto_texto' : spec.layout
  const medio = spec.fondo === 'liso' ? null : elegirMedio(spec, ctx)
  const velo = veloDe(layout, estilo)
  // Con «velo» propio (editor) el oscurecimiento es el que se eligió; si no, el de la plantilla.
  const veloEl = (v: number) =>
    spec.velo !== undefined
      ? `<div class="ig-velo" style="opacity:${(spec.velo / 100).toFixed(2)}"></div>`
      : `<div class="ig-velo ig-velo-${v}"></div>`

  let fondo: string
  if (layout === 'partida') {
    const [a, b] = [elegirMedio(spec, ctx, 1), elegirMedio(spec, ctx, 2)] as Medio[]
    fondo = `<div class="ig-partida"><div>${medioHtml(a)}${veloEl(velo)}</div><div>${medioHtml(b)}${veloEl(velo)}</div></div>`
  } else if (medio) {
    fondo = `${medioHtml(medio, spec.fondoPos)}${veloEl(velo)}`
  } else {
    fondo = `<div class="ig-foto" style="background:${esc(fondoLiso(brand))}"></div>`
  }

  const verFecha = spec.fecha ?? ctx.indice === 0
  const verLogo =
    Boolean(brand.logoUrl) &&
    (estilo === 'marca' || ctx.indice === 0 || spec.ultima === true || ctx.indice === ctx.total - 1)
  const cabecera =
    verFecha || verLogo
      ? `<div class="ig-cabecera">${verFecha ? `<div class="ig-etiqueta-fecha">${fechaEtiqueta(ctx.hoy)}</div>` : ''}${
          verLogo ? `<img class="ig-logo" src="${esc(brand.logoUrl)}" alt="">` : ''
        }</div>`
      : ''

  const titulo = tituloHtml(spec, estilo)
  const texto = bloqueTexto(spec.texto, estilo, spec)
  let zona = 'centro'
  let contenido = `${titulo}${texto}`
  if (layout === 'portada') {
    zona = medio ? 'abajo' : 'centro'
  } else if (layout === 'foto_texto' || layout === 'partida') {
    zona = layout === 'partida' ? 'centro' : 'abajo'
  } else if (layout === 'comparacion') {
    contenido = `${titulo}${(spec.items ?? []).map(recuadro).join('')}${texto}`
  } else if (layout === 'sticker') {
    contenido = `${titulo}${texto}${spec.sticker ? stickerHtml(spec.sticker) : ''}`
  } else if (layout === 'captura' && spec.pedido) {
    contenido = `${titulo}${texto}${capturaHtml(spec.pedido, ctx.pedidos?.[spec.pedido.clave])}`
  } else if (layout === 'cifra') {
    contenido = `<div class="ig-cifra">${esc(spec.cifra ?? '')}</div>${titulo}${texto}`
  }
  const centrado = zona === 'centro' ? ' ig-centrado' : ''
  // Tipografía: la del editor de Instagram; solo el estilo «De marca» usa las de la marca (si no se pide otra).
  const fuente = spec.fuente ?? (estilo === 'editorial' ? 'serif' : estilo === 'marca' ? null : 'classic')

  const acento = brand.colors.accent || brand.colors.primary
  const vars = [
    `--ig-acento:${acento}`,
    `--ig-acento-texto:${esOscuro(acento) ? '#ffffff' : '#111111'}`,
    estilo === 'marca' ? fuentesDeMarca(brand) : null,
    spec.plataforma === 'tiktok'
      ? `--ig-seg-arriba:${SEGURA_POR_PLATAFORMA.tiktok.arriba}px;--ig-seg-abajo:${SEGURA_POR_PLATAFORMA.tiktok.abajo}px;--ig-seg-derecha:${SEGURA_POR_PLATAFORMA.tiktok.derecha}px`
      : null,
  ]
    .filter(Boolean)
    .join(';')
  const datos = esc(JSON.stringify({ spec, estilo, hoy: ctx.hoy.toISOString() }))
  // Modo libre: sin columna de plantilla; cada capa va donde se puso.
  if (spec.capas)
    return `<div class="ig-historia" data-spec="${datos}" style="${esc(vars)}"><div class="ig-fondo">${fondo}</div>${cabecera}${renderCapas(spec.capas, ctx)}</div>`
  return `<div class="ig-historia" data-spec="${datos}" style="${esc(vars)}"><div class="ig-fondo">${fondo}</div>${cabecera}<div class="ig-zona ig-zona-${spec.posicion === undefined ? zona : 'libre'}${centrado}${fuente ? ` ig-f-${fuente}` : ''}"${spec.posicion === undefined ? '' : ` style="--ig-top:${posicionPx(spec.posicion, spec.plataforma)}px"`}>${contenido}</div></div>`
}
