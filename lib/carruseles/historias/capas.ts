import { SEGURA_POR_PLATAFORMA, type Plataforma } from './estilo-nativo'
import { FUENTES_IG, type FuenteIg } from './fuentes-ig'
import { capturaHtml, corta, esc, stickerHtml } from './html-util'
import { esTipoPedido, limpiarClave, TIPOS_PEDIDO, type Pedido } from './pedidos'
import type { ContextoRender, HistoriaSpec } from './layouts'

// EDITOR LIBRE POR CAPAS (modo «pro» de las historias).
//
// Una historia en modo libre es: fondo (foto o liso, con su encuadre y oscurecimiento) + cabecera (fecha y logo) + una
// lista de CAPAS colocadas a mano sobre el lienzo de 1080×1920. El orden de la lista es el orden de apilado (la última
// va encima). Cada capa lleva sus coordenadas en píxeles del lienzo, así que la misma historia se ve igual en el editor,
// en la vista previa y al exportar.
//
// Este módulo es puro (sin DOM): valida lo que llega del navegador, compone el HTML de cada capa, convierte una plantilla
// en capas y ofrece las operaciones que usa el editor (guías magnéticas, alinear, ordenar). Así se prueba sin navegador.

export const LIENZO = { ancho: 1080, alto: 1920 } as const
export const MAX_CAPAS = 30

// ── Tipos
export type FondoPos = { x: number; y: number; zoom: number }

export type ColorTexto = 'blanco' | 'negro' | 'marca'
/** Aspecto de la caja del texto; con caja, el color del texto se elige solo para que se lea. */
export type CajaTexto = 'sin' | 'blanca' | 'negra' | 'negra-suave' | 'blanca-suave' | 'marca' | 'marcador'
export type ColorForma = 'blanco' | 'marca' | 'rojo' | 'amarillo'

type Comun = {
  id: string
  /** Esquina superior izquierda y ancho, en píxeles del lienzo (1080×1920). */
  x: number
  y: number
  w: number
  /** Giro en grados (−180…180). */
  rot?: number
  oculta?: boolean
  bloqueada?: boolean
  /** 0,1…1. */
  opacidad?: number
}

export type CapaTexto = Comun & {
  tipo: 'texto'
  texto: string
  /** Si la capa nace del titular o del texto de la plantilla, se mantiene sincronizada con la especificación (revisión de la secuencia). */
  rol?: 'titulo' | 'texto'
  /** Palabra o frase resaltada con el marcador de la marca. */
  acento?: string
  fuente?: FuenteIg
  tam: number
  color: ColorTexto
  caja: CajaTexto
  alinea: 'izq' | 'centro' | 'der'
}
export type CapaImagen = Comun & {
  tipo: 'imagen'
  h: number
  /** Número (desde 1) de la foto o vídeo de «Fotos y vídeos»… */
  foto?: number
  /** …o una dirección https propia… */
  url?: string
  /** …o material real pedido (captura de pago, testimonio…). */
  pedido?: Pedido
  ajuste: 'cubrir' | 'contener'
  /** Punto de enfoque (0-100) cuando la foto se recorta. */
  enfoque?: { x: number; y: number }
  radio: number
  marco: boolean
  sombra: boolean
}
export type CapaEmoji = Comun & { tipo: 'emoji'; emoji: string; tam: number }
export type CapaSticker = Comun & {
  tipo: 'sticker'
  sticker: 'pregunta' | 'escribe' | 'encuesta'
  cabecera?: string
  texto?: string
  opciones?: [string, string]
}
export type CapaForma = Comun & {
  tipo: 'forma'
  forma: 'flecha' | 'circulo' | 'subrayado' | 'caja'
  color: ColorForma
  h: number
  grosor: number
}
export type Capa = CapaTexto | CapaImagen | CapaEmoji | CapaSticker | CapaForma
export type TipoCapa = Capa['tipo']

export const TIPOS_CAPA: readonly TipoCapa[] = ['texto', 'imagen', 'emoji', 'sticker', 'forma']
export const CAJAS_TEXTO: readonly CajaTexto[] = [
  'sin',
  'blanca',
  'negra',
  'negra-suave',
  'blanca-suave',
  'marca',
  'marcador',
]
export const FORMAS = ['flecha', 'circulo', 'subrayado', 'caja'] as const
export const COLORES_FORMA: readonly ColorForma[] = ['blanco', 'marca', 'rojo', 'amarillo']

// ── Validación (lo que llega del navegador es dato no fiable)
const LIM = {
  x: [-540, 1620],
  y: [-960, 2880],
  w: [40, 1400],
  h: [20, 2400],
  tam: [20, 260],
  rot: [-180, 180],
} as const

const fijar = (v: unknown, [min, max]: readonly [number, number], def: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def
const entero = (v: unknown, lim: readonly [number, number], def: number) => Math.round(fijar(v, lim, def))
const txt = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? corta(v.trim(), n) : undefined)
const esHttps = (v: unknown): v is string =>
  typeof v === 'string' && v.length <= 800 && /^https:\/\/[^\s"'<>]+$/.test(v)
const esUno = <T extends string>(lista: readonly T[], v: unknown): v is T => (lista as readonly unknown[]).includes(v)

export function leerFondoPos(v: unknown): FondoPos | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  const p: FondoPos = {
    x: Math.round(fijar(o.x, [0, 100], 50)),
    y: Math.round(fijar(o.y, [0, 100], 50)),
    zoom: Math.round(fijar(o.zoom, [1, 3], 1) * 100) / 100,
  }
  return p.x === 50 && p.y === 50 && p.zoom === 1 ? undefined : p
}

/** Estilo CSS del encuadre de la foto de fondo (la foto ya va con `object-fit: cover`). */
export const estiloFondoPos = (p: FondoPos): string =>
  `object-position:${p.x}% ${p.y}%;transform:scale(${p.zoom});transform-origin:${p.x}% ${p.y}%`

function idLimpio(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '')
    .slice(0, 12)
}

/** Identificador nuevo que no esté en uso. */
export function nuevoId(capas: readonly { id: string }[]): string {
  const usados = new Set(capas.map((c) => c.id))
  let n = capas.length + 1
  while (usados.has(`c${n}`)) n++
  return `c${n}`
}

/** Valida y acota una lista de capas. Lo desconocido se descarta; nunca lanza. */
export function leerCapas(entrada: unknown): Capa[] {
  if (!Array.isArray(entrada)) return []
  const salida: Capa[] = []
  const usados = new Set<string>()
  for (const raw of entrada.slice(0, MAX_CAPAS)) {
    const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
    if (!o || !esUno(TIPOS_CAPA, o.tipo)) continue
    let id = idLimpio(o.id)
    if (!id || usados.has(id)) id = nuevoId(salida)
    usados.add(id)
    const comun = {
      id,
      x: entero(o.x, LIM.x, 0),
      y: entero(o.y, LIM.y, 0),
      w: entero(o.w, LIM.w, 400),
      rot: o.rot === undefined ? undefined : Math.round(fijar(o.rot, LIM.rot, 0) * 10) / 10 || undefined,
      oculta: o.oculta === true ? true : undefined,
      bloqueada: o.bloqueada === true ? true : undefined,
      opacidad:
        typeof o.opacidad === 'number' && o.opacidad < 1
          ? Math.round(fijar(o.opacidad, [0.1, 1], 1) * 100) / 100
          : undefined,
    }
    switch (o.tipo) {
      case 'texto':
        salida.push({
          ...comun,
          tipo: 'texto',
          texto: typeof o.texto === 'string' ? corta(o.texto, 400) : '',
          rol: o.rol === 'titulo' || o.rol === 'texto' ? o.rol : undefined,
          acento: txt(o.acento, 60),
          fuente: esUno(FUENTES_IG, o.fuente) ? o.fuente : undefined,
          tam: entero(o.tam, LIM.tam, 58),
          color: esUno(['blanco', 'negro', 'marca'] as const, o.color) ? o.color : 'blanco',
          caja: esUno(CAJAS_TEXTO, o.caja) ? o.caja : 'sin',
          alinea: esUno(['izq', 'centro', 'der'] as const, o.alinea) ? o.alinea : 'izq',
        })
        break
      case 'imagen': {
        const p = (o.pedido && typeof o.pedido === 'object' ? o.pedido : null) as Record<string, unknown> | null
        const clave = p ? limpiarClave(p.clave) : ''
        const e = (o.enfoque && typeof o.enfoque === 'object' ? o.enfoque : null) as Record<string, unknown> | null
        salida.push({
          ...comun,
          tipo: 'imagen',
          h: entero(o.h, LIM.h, 400),
          foto: Number.isInteger(o.foto) && (o.foto as number) >= 1 ? (o.foto as number) : undefined,
          url: esHttps(o.url) ? o.url : undefined,
          pedido:
            p && clave && esTipoPedido(p.tipo)
              ? { clave, tipo: p.tipo, titulo: txt(p.titulo, 80) ?? TIPOS_PEDIDO[p.tipo].etiqueta }
              : undefined,
          ajuste: o.ajuste === 'contener' ? 'contener' : 'cubrir',
          enfoque: e ? { x: Math.round(fijar(e.x, [0, 100], 50)), y: Math.round(fijar(e.y, [0, 100], 50)) } : undefined,
          radio: entero(o.radio, [0, 300], 0),
          marco: o.marco === true,
          sombra: o.sombra === true,
        })
        break
      }
      case 'emoji':
        salida.push({
          ...comun,
          tipo: 'emoji',
          emoji: txt(o.emoji, 8) ?? '⭐',
          tam: entero(o.tam, [40, 400], 140),
        })
        break
      case 'sticker': {
        const op = Array.isArray(o.opciones) ? o.opciones : []
        salida.push({
          ...comun,
          tipo: 'sticker',
          sticker: esUno(['pregunta', 'escribe', 'encuesta'] as const, o.sticker) ? o.sticker : 'pregunta',
          cabecera: txt(o.cabecera, 30),
          texto: txt(o.texto, 120),
          opciones: op.length >= 2 ? [txt(op[0], 24) ?? 'Sí', txt(op[1], 24) ?? 'No'] : undefined,
        })
        break
      }
      case 'forma':
        salida.push({
          ...comun,
          tipo: 'forma',
          forma: esUno(FORMAS, o.forma) ? o.forma : 'flecha',
          color: esUno(COLORES_FORMA, o.color) ? o.color : 'marca',
          h: entero(o.h, LIM.h, 160),
          grosor: entero(o.grosor, [3, 30], 8),
        })
        break
    }
  }
  return salida
}

// ── Render de cada capa
const r = (n: number) => Math.round(n * 10) / 10

const COLOR_FORMA: Record<ColorForma, string> = {
  blanco: '#ffffff',
  marca: 'var(--ig-acento)',
  rojo: '#ef4444',
  amarillo: '#fde047',
}
const CLASE_CAJA: Record<Exclude<CajaTexto, 'sin'>, string> = {
  blanca: 'ig-caja',
  negra: 'ig-caja-solida-negra',
  'negra-suave': 'ig-caja-negra',
  'blanca-suave': 'ig-caja-vidrio',
  marca: 'ig-caja-acento',
  marcador: 'ig-marcador',
}
const COLOR_TEXTO: Record<ColorTexto, string> = { blanco: '#fff', negro: '#111', marca: 'var(--ig-acento)' }
const ALINEA = { izq: 'left', centro: 'center', der: 'right' } as const

/** Texto escapado con saltos de línea y, opcionalmente, una frase resaltada. */
function textoHtml(texto: string, acento: string | undefined): string {
  const i = acento ? texto.toLowerCase().indexOf(acento.toLowerCase()) : -1
  const parte = (s: string) => esc(s).replace(/\n/g, '<br>')
  if (!acento || i < 0) return parte(texto)
  return `${parte(texto.slice(0, i))}<span class="ig-marcador">${parte(texto.slice(i, i + acento.length))}</span>${parte(texto.slice(i + acento.length))}`
}

function trazoForma(c: CapaForma): string {
  const w = Math.max(c.w, 1)
  const h = Math.max(c.h, 1)
  const g = c.grosor
  const p = (d: string) => `<path d="${d}"/>`
  switch (c.forma) {
    case 'flecha': {
      const ex = r(w * 0.92)
      const ey = r(h * 0.62)
      return (
        p(`M${r(w * 0.05)} ${r(h * 0.88)} C${r(w * 0.25)} ${r(h * 0.12)} ${r(w * 0.68)} ${r(h * 0.06)} ${ex} ${ey}`) +
        p(`M${ex} ${ey} l${r(-w * 0.17)} ${r(-h * 0.06)} M${ex} ${ey} l${r(-w * 0.04)} ${r(-h * 0.36)}`)
      )
    }
    case 'circulo':
      return p(
        `M${r(w * 0.5)} ${r(h * 0.05)} C${r(w * 0.96)} ${r(h * 0.02)} ${r(w * 0.99)} ${r(h * 0.9)} ${r(w * 0.5)} ${r(h * 0.95)} ` +
          `C${r(w * 0.04)} ${r(h * 1.0)} ${r(w * 0.01)} ${r(h * 0.12)} ${r(w * 0.55)} ${r(h * 0.04)}`
      )
    case 'subrayado':
      return p(
        `M${r(w * 0.02)} ${r(h * 0.6)} Q${r(w * 0.16)} ${r(h * 0.2)} ${r(w * 0.3)} ${r(h * 0.6)} T${r(w * 0.6)} ${r(h * 0.6)} T${r(w * 0.98)} ${r(h * 0.5)}`
      )
    case 'caja':
      return `<rect x="${g / 2}" y="${g / 2}" width="${r(Math.max(w - g, 1))}" height="${r(Math.max(h - g, 1))}" rx="${r(Math.min(64, h / 2))}"/>`
  }
}

function origenImagen(c: CapaImagen, ctx: ContextoRender): { url: string; kind: 'image' | 'video' } | null {
  if (c.url) return { url: c.url, kind: /\.(mp4|webm|mov)(\?|$)/i.test(c.url) ? 'video' : 'image' }
  if (c.pedido) {
    const u = ctx.pedidos?.[c.pedido.clave]
    return u ? { url: u, kind: 'image' } : null
  }
  const m = c.foto ? ctx.media[c.foto - 1] : undefined
  return m ? { url: m.url, kind: m.kind } : null
}

function interiorCapa(c: Capa, ctx: ContextoRender): string {
  switch (c.tipo) {
    case 'texto': {
      const cuerpo = textoHtml(c.texto, c.acento)
      const base = `font-size:${c.tam}px;text-align:${ALINEA[c.alinea]}`
      const clase = `ig-capa-t${c.fuente ? ` ig-f-${c.fuente}` : ''}`
      if (c.caja === 'sin')
        return `<div class="${clase}"><div class="ig-texto" style="${base};color:${COLOR_TEXTO[c.color]}">${cuerpo}</div></div>`
      return `<div class="${clase}" style="${base}"><span class="${CLASE_CAJA[c.caja]}" style="font-size:inherit">${cuerpo}</span></div>`
    }
    case 'imagen': {
      const o = origenImagen(c, ctx)
      const cls = `ig-capa-img${c.marco ? ' ig-marco' : ''}${c.sombra ? ' ig-sombra' : ''}`
      const radio = `border-radius:${c.radio}px`
      if (!o) {
        const hueco = c.pedido
          ? capturaHtml(c.pedido, undefined)
          : '<div class="ig-capa-vacia"><span class="ig-emoji">🖼️</span>Foto</div>'
        return `<div class="${cls}" style="${radio}">${hueco}</div>`
      }
      const pos = c.enfoque ? `;object-position:${c.enfoque.x}% ${c.enfoque.y}%` : ''
      const est = `object-fit:${c.ajuste === 'contener' ? 'contain' : 'cover'}${pos}`
      const medio =
        o.kind === 'video'
          ? `<video src="${esc(o.url)}" style="${est}" muted loop autoplay playsinline crossorigin="anonymous"></video>`
          : `<img src="${esc(o.url)}" style="${est}" alt="">`
      return `<div class="${cls}" style="${radio}">${medio}</div>`
    }
    case 'emoji':
      return `<div class="ig-capa-emoji" style="font-size:${c.tam}px">${esc(c.emoji)}</div>`
    case 'sticker':
      if (c.sticker === 'encuesta') {
        const [a, b] = c.opciones ?? ['Sí', 'No']
        return `<div class="ig-sticker-encuesta"><div class="ig-se-cab">${esc(c.texto ?? '¿Qué eliges?')}</div><div class="ig-se-op"><span>${esc(a)}</span><span>${esc(b)}</span></div></div>`
      }
      return stickerHtml({ tipo: c.sticker, cabecera: c.cabecera, texto: c.texto })
    case 'forma':
      return `<svg width="${c.w}" height="${c.h}" viewBox="0 0 ${c.w} ${c.h}" style="display:block;overflow:visible;fill:none;stroke:${COLOR_FORMA[c.color]};stroke-width:${c.grosor}px;stroke-linecap:round;stroke-linejoin:round">${trazoForma(c)}</svg>`
  }
}

const tieneAltoFijo = (c: Capa): c is CapaImagen | CapaForma => c.tipo === 'imagen' || c.tipo === 'forma'

export function renderCapa(c: Capa, ctx: ContextoRender): string {
  const estilo = [
    `left:${c.x}px`,
    `top:${c.y}px`,
    `width:${c.w}px`,
    tieneAltoFijo(c) ? `height:${c.h}px` : null,
    c.rot ? `transform:rotate(${c.rot}deg)` : null,
    c.opacidad !== undefined ? `opacity:${c.opacidad}` : null,
  ]
    .filter(Boolean)
    .join(';')
  return `<div class="ig-capa" data-capa="${esc(c.id)}" data-tipo="${c.tipo}" style="${estilo}">${interiorCapa(c, ctx)}</div>`
}

/** Capas visibles, en orden de apilado (la última, encima). */
export const renderCapas = (capas: readonly Capa[], ctx: ContextoRender): string =>
  capas
    .filter((c) => !c.oculta)
    .map((c) => renderCapa(c, ctx))
    .join('')

/**
 * Aplica unas capas a la especificación y mantiene `titulo`, `acento` y `texto` alineados con las capas que nacieron de ellos
 * (rol): así la revisión de la secuencia sigue viendo el gancho aunque se haya movido, editado o borrado a mano.
 */
export function conCapas(spec: HistoriaSpec, capas: Capa[]): HistoriaSpec {
  const rol = (lista: readonly Capa[] | undefined, r: 'titulo' | 'texto') =>
    lista?.find((c): c is CapaTexto => c.tipo === 'texto' && c.rol === r)
  const antes = spec.capas
  const sig: HistoriaSpec = { ...spec, capas }
  const t = rol(capas, 'titulo')
  const x = rol(capas, 'texto')
  if (t) {
    sig.titulo = corta(t.texto.trim(), 110) || undefined
    sig.acento = t.acento
  } else if (rol(antes, 'titulo')) {
    sig.titulo = undefined
    sig.acento = undefined
  }
  if (x) sig.texto = corta(x.texto.trim(), 240) || undefined
  else if (rol(antes, 'texto')) sig.texto = undefined
  return sig
}

/** Lo contrario de `conCapas`: lleva el titular, el acento y el texto de la especificación a las capas que nacieron de ellos (p. ej. al aplicar una variante de la IA). */
export function capasConTextos(spec: HistoriaSpec): HistoriaSpec {
  if (!spec.capas) return spec
  return {
    ...spec,
    capas: spec.capas.map((c) => {
      if (c.tipo !== 'texto') return c
      if (c.rol === 'titulo' && spec.titulo !== undefined) return { ...c, texto: spec.titulo, acento: spec.acento }
      if (c.rol === 'texto' && spec.texto !== undefined) return { ...c, texto: spec.texto }
      return c
    }),
  }
}

// ── Capas nuevas
const centrar = (w: number) => Math.round((LIENZO.ancho - w) / 2)

/** Capa nueva del tipo pedido, centrada en el lienzo (o en el punto indicado) y con valores por defecto legibles. */
export function capaNueva(
  tipo: TipoCapa,
  existentes: readonly Capa[],
  opciones: { x?: number; y?: number; foto?: number; texto?: string; emoji?: string } = {}
): Capa {
  const id = nuevoId(existentes)
  const colocar = (w: number, h: number) => ({
    x: Math.round(opciones.x !== undefined ? opciones.x - w / 2 : centrar(w)),
    y: Math.round(opciones.y !== undefined ? opciones.y - h / 2 : (LIENZO.alto - h) / 2),
  })
  switch (tipo) {
    case 'texto':
      return {
        id,
        tipo,
        ...colocar(760, 160),
        w: 760,
        texto: opciones.texto ?? 'Escribe aquí',
        tam: 64,
        color: 'blanco',
        caja: 'negra-suave',
        alinea: 'centro',
      }
    case 'imagen':
      return {
        id,
        tipo,
        ...colocar(620, 820),
        w: 620,
        h: 820,
        foto: opciones.foto,
        ajuste: 'cubrir',
        radio: 40,
        marco: false,
        sombra: true,
      }
    case 'emoji':
      return { id, tipo, ...colocar(180, 180), w: 180, emoji: opciones.emoji ?? '🔥', tam: 150 }
    case 'sticker':
      return {
        id,
        tipo,
        ...colocar(760, 320),
        w: 760,
        sticker: 'pregunta',
        cabecera: 'HABLEMOS CLARO',
        texto: '¿Qué quieres saber?',
      }
    case 'forma':
      return { id, tipo, ...colocar(260, 190), w: 260, h: 190, forma: 'flecha', color: 'blanco', grosor: 9 }
  }
}

// ── Operaciones del editor (puras: devuelven una lista nueva)
export type Orden = 'frente' | 'fondo' | 'subir' | 'bajar'

export function ordenar(capas: readonly Capa[], id: string, orden: Orden): Capa[] {
  const i = capas.findIndex((c) => c.id === id)
  if (i < 0) return [...capas]
  const lista = [...capas]
  const [c] = lista.splice(i, 1)
  const destino =
    orden === 'frente'
      ? lista.length
      : orden === 'fondo'
        ? 0
        : Math.min(lista.length, Math.max(0, i + (orden === 'subir' ? 1 : -1)))
  lista.splice(destino, 0, c)
  return lista
}

export function duplicar(capas: readonly Capa[], id: string): { capas: Capa[]; nueva: Capa | null } {
  const c = capas.find((x) => x.id === id)
  if (!c || capas.length >= MAX_CAPAS) return { capas: [...capas], nueva: null }
  const nueva: Capa = { ...c, id: nuevoId(capas), x: c.x + 40, y: c.y + 40, bloqueada: undefined }
  return { capas: [...capas, nueva], nueva }
}

export const sinCapa = (capas: readonly Capa[], id: string): Capa[] => capas.filter((c) => c.id !== id)

export const cambiarCapa = (capas: readonly Capa[], id: string, cambios: Partial<Capa>): Capa[] =>
  capas.map((c) => (c.id === id ? ({ ...c, ...cambios } as Capa) : c))

// ── Guías magnéticas y alineado
export type Caja = { x: number; y: number; w: number; h: number }
export type Guias = { x: number[]; y: number[] }

/** Líneas del lienzo a las que se pega una capa: bordes, centro y márgenes de la zona segura de la red. */
export function lineasDelLienzo(plataforma: Plataforma = 'instagram'): { x: number[]; y: number[] } {
  const z = SEGURA_POR_PLATAFORMA[plataforma]
  return {
    x: [0, 70, LIENZO.ancho / 2, LIENZO.ancho - z.derecha, LIENZO.ancho],
    y: [0, z.arriba, LIENZO.alto / 2, LIENZO.alto - z.abajo, LIENZO.alto],
  }
}

/**
 * Pega `caja` a la guía más cercana (bordes y centro de la caja contra las líneas del lienzo y las de las demás capas)
 * si está a menos de `umbral` px. Devuelve la posición ajustada y las guías que se están usando, para dibujarlas.
 */
export function ajustar(
  caja: Caja,
  otras: readonly Caja[],
  opciones: { umbral?: number; plataforma?: Plataforma } = {}
): { x: number; y: number; guias: Guias } {
  const umbral = opciones.umbral ?? 10
  const lienzo = lineasDelLienzo(opciones.plataforma)
  const lx = [...lienzo.x]
  const ly = [...lienzo.y]
  for (const o of otras) {
    lx.push(o.x, o.x + o.w / 2, o.x + o.w)
    ly.push(o.y, o.y + o.h / 2, o.y + o.h)
  }
  const mejor = (puntos: number[], lineas: number[]): { delta: number; linea: number } | null => {
    let m: { delta: number; linea: number } | null = null
    for (const p of puntos)
      for (const l of lineas) {
        const d = l - p
        if (Math.abs(d) <= umbral && (!m || Math.abs(d) < Math.abs(m.delta))) m = { delta: d, linea: l }
      }
    return m
  }
  const mx = mejor([caja.x, caja.x + caja.w / 2, caja.x + caja.w], lx)
  const my = mejor([caja.y, caja.y + caja.h / 2, caja.y + caja.h], ly)
  return {
    x: Math.round(caja.x + (mx?.delta ?? 0)),
    y: Math.round(caja.y + (my?.delta ?? 0)),
    guias: { x: mx ? [mx.linea] : [], y: my ? [my.linea] : [] },
  }
}

export type Alineado = 'izquierda' | 'centro' | 'derecha' | 'arriba' | 'medio' | 'abajo'

/** Posición (x, y) de la capa tras alinearla con el lienzo (dentro de los márgenes de la zona segura). */
export function alinear(caja: Caja, modo: Alineado, plataforma: Plataforma = 'instagram'): { x: number; y: number } {
  const z = SEGURA_POR_PLATAFORMA[plataforma]
  switch (modo) {
    case 'izquierda':
      return { x: 70, y: caja.y }
    case 'derecha':
      return { x: Math.round(LIENZO.ancho - z.derecha - caja.w), y: caja.y }
    case 'centro':
      return { x: Math.round((LIENZO.ancho - caja.w) / 2), y: caja.y }
    case 'arriba':
      return { x: caja.x, y: z.arriba }
    case 'abajo':
      return { x: caja.x, y: Math.round(LIENZO.alto - z.abajo - caja.h) }
    case 'medio':
      return { x: caja.x, y: Math.round((LIENZO.alto - caja.h) / 2) }
  }
}

/** Cuánto se sale la caja de la zona visible de la red (0 = dentro). Para avisar de lo que la interfaz taparía. */
export function invasionZonaSegura(caja: Caja, plataforma: Plataforma = 'instagram'): boolean {
  const z = SEGURA_POR_PLATAFORMA[plataforma]
  return (
    caja.y < z.arriba - 1 ||
    caja.y + caja.h > LIENZO.alto - z.abajo + 1 ||
    caja.x + caja.w > LIENZO.ancho - z.derecha + 1
  )
}

// ── Conversión de una plantilla a capas
const lineasDe = (texto: string, tam: number, ancho: number): number =>
  texto
    .split('\n')
    .reduce((n, p) => n + Math.max(1, Math.ceil(p.length / Math.max(1, Math.floor(ancho / (tam * 0.52))))), 0)

/**
 * Convierte la composición de una plantilla en capas para poder moverlas una a una. Las alturas se estiman (la plantilla
 * las decide el navegador al pintar); la persona afina después arrastrando.
 */
export function capasDeSpec(spec: HistoriaSpec, opciones: { estilo?: string; hayFoto?: boolean } = {}): Capa[] {
  const plataforma: Plataforma = spec.plataforma ?? 'instagram'
  const z = SEGURA_POR_PLATAFORMA[plataforma]
  const X = 70
  const W = LIENZO.ancho - X - z.derecha
  const estilo = opciones.estilo ?? 'nativo'
  const zona =
    spec.layout === 'portada'
      ? opciones.hayFoto && spec.fondo !== 'liso'
        ? 'abajo'
        : 'centro'
      : spec.layout === 'foto_texto'
        ? 'abajo'
        : 'centro'
  const centrado = zona === 'centro'
  const alinea = centrado ? 'centro' : 'izq'
  const GAP = 34

  type Pieza = { alto: number; capas: (y: number) => Capa[] }
  const piezas: Pieza[] = []
  let n = 0
  const id = () => `c${++n}`

  const titulo = () => {
    if (!spec.titulo) return
    const tam = spec.titulo.length <= 40 ? 112 : spec.titulo.length <= 70 ? 92 : 76
    const alto = Math.round(lineasDe(spec.titulo, tam, W) * tam * 1.04)
    piezas.push({
      alto,
      capas: (y) => [
        {
          id: id(),
          tipo: 'texto',
          x: X,
          y,
          w: W,
          rol: 'titulo',
          texto: spec.titulo as string,
          acento: spec.acento,
          fuente: spec.fuente ?? 'serif',
          tam,
          color: 'blanco',
          caja: 'sin',
          alinea,
        },
      ],
    })
  }
  const texto = () => {
    if (!spec.texto) return
    const caja: CajaTexto = spec.fondoTexto
      ? spec.fondoTexto === 'sin'
        ? 'sin'
        : spec.fondoTexto === 'solido'
          ? spec.colorTexto === 'negro'
            ? 'negra'
            : spec.colorTexto === 'marca'
              ? 'marca'
              : 'blanca'
          : spec.colorTexto === 'blanco'
            ? 'blanca-suave'
            : 'negra-suave'
      : estilo === 'editorial'
        ? 'sin'
        : estilo === 'marca'
          ? 'marca'
          : 'negra-suave'
    const tam = caja === 'sin' ? 58 : 56
    const alto = Math.round(lineasDe(spec.texto, tam, W - 48) * tam * (caja === 'sin' ? 1.3 : 1.7))
    piezas.push({
      alto,
      capas: (y) => [
        {
          id: id(),
          tipo: 'texto',
          x: X,
          y,
          w: W,
          rol: 'texto',
          texto: spec.texto as string,
          fuente: spec.fuente,
          tam,
          color: 'blanco',
          caja,
          alinea,
        },
      ],
    })
  }

  if (spec.layout === 'cifra' && spec.cifra) {
    piezas.push({
      alto: 230,
      capas: (y) => [
        {
          id: id(),
          tipo: 'texto',
          x: X,
          y,
          w: W,
          texto: spec.cifra as string,
          fuente: 'serif',
          tam: 230,
          color: 'marca',
          caja: 'sin',
          alinea,
        },
      ],
    })
  }
  titulo()
  if (spec.layout === 'comparacion')
    for (const it of spec.items ?? []) {
      const cuerpo = `${it.icono ? `${it.icono} ` : ''}${it.titulo}${it.texto ? `\n${it.texto}` : ''}`
      const alto = 72 + lineasDe(it.titulo, 64, W - 88) * 74 + (it.texto ? lineasDe(it.texto, 52, W - 88) * 68 : 0)
      piezas.push({
        alto,
        capas: (y) => [
          { id: id(), tipo: 'forma', forma: 'caja', color: 'marca', x: X, y, w: W, h: alto, grosor: 7 },
          {
            id: id(),
            tipo: 'texto',
            x: X + 44,
            y: y + 36,
            w: W - 88,
            texto: cuerpo,
            fuente: 'serif',
            tam: 56,
            color: 'blanco',
            caja: 'sin',
            alinea: 'centro',
          },
        ],
      })
    }
  texto()
  if (spec.layout === 'sticker' && spec.sticker) {
    const s = spec.sticker
    const w = s.tipo === 'pregunta' ? 760 : 640
    piezas.push({
      alto: s.tipo === 'pregunta' ? 280 : 200,
      capas: (y) => [
        {
          id: id(),
          tipo: 'sticker',
          sticker: s.tipo,
          cabecera: s.cabecera,
          texto: s.texto,
          x: centrar(w),
          y,
          w,
        },
      ],
    })
  }
  if (spec.layout === 'captura' && spec.pedido) {
    const p = spec.pedido
    piezas.push({
      alto: 720,
      capas: (y) => [
        {
          id: id(),
          tipo: 'imagen',
          pedido: p,
          x: centrar(720),
          y,
          w: 720,
          h: 720,
          ajuste: 'contener',
          radio: 26,
          marco: true,
          sombra: true,
        },
      ],
    })
  }

  const total = piezas.reduce((s, p) => s + p.alto, 0) + GAP * Math.max(0, piezas.length - 1)
  let y =
    spec.posicion !== undefined
      ? Math.round(z.arriba + (spec.posicion / 100) * (LIENZO.alto - z.arriba - z.abajo - 200))
      : zona === 'abajo'
        ? LIENZO.alto - z.abajo - total
        : zona === 'centro'
          ? Math.round((LIENZO.alto - total) / 2)
          : z.arriba
  y = Math.max(z.arriba, y)
  const capas: Capa[] = []
  for (const p of piezas) {
    capas.push(...p.capas(y))
    y += p.alto + GAP
  }
  return capas.slice(0, MAX_CAPAS)
}
