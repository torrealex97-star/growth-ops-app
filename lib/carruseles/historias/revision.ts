import type { HistoriaSpec } from './layouts'

// REVISIÓN DE UNA SECUENCIA antes de publicar: lo que un editor de redes mira a ojo. Puro (sin red ni base de datos).
// Las cifras salen de cómo se ven las historias: una historia de imagen dura ~5 s en Instagram y el ojo lee unas 3 palabras/s.

export type Hallazgo = { nivel: 'error' | 'aviso'; historia: number | null; mensaje: string }

export const SEGUNDOS_POR_HISTORIA = 5
const PALABRAS_POR_SEGUNDO = 3
export const MAX_PALABRAS_GANCHO = 12
/** Verbos de acción (cualquier conjugación: «guárdalo», «mándame») y palabras sueltas; siempre al inicio de palabra (sin «dm» dentro de «admito»). */
const ACCION =
  /\?|(?<![\p{L}\p{N}])(?:(?:escrib|coment|respond|guard|guárd|compart|mand|mánd|envi|envía|pulsa)\p{L}*|dm|mensaje|link|enlace)(?![\p{L}\p{N}])/iu
const EMOJI = /\p{Extended_Pictographic}/gu

const palabras = (s: string | undefined) => (s ?? '').trim().split(/\s+/).filter(Boolean).length

/** Todo el texto que ve la persona en una historia. */
export const textoDeHistoria = (s: HistoriaSpec): string =>
  [
    s.titulo,
    s.texto,
    s.cifra,
    ...(s.items ?? []).flatMap((i) => [i.titulo, i.texto]),
    s.sticker?.cabecera,
    s.sticker?.texto,
  ]
    .filter(Boolean)
    .join(' ')

/** Segundos que hacen falta para leer la historia con calma (mínimo 2). */
export const segundosDeLectura = (s: HistoriaSpec): number =>
  Math.max(2, Math.ceil(palabras(textoDeHistoria(s)) / PALABRAS_POR_SEGUNDO) + 1)

export function revisarSecuencia(
  specs: HistoriaSpec[],
  opciones: { hayMedios: boolean; pendientes: number }
): Hallazgo[] {
  const h: Hallazgo[] = []
  const n = specs.length
  if (n === 0) return h
  if (opciones.pendientes > 0)
    h.push({
      nivel: 'error',
      historia: null,
      mensaje: `Falta material real en ${opciones.pendientes} pedido${opciones.pendientes === 1 ? '' : 's'}: saldría un recuadro «FALTA».`,
    })
  if (n < 3)
    h.push({
      nivel: 'aviso',
      historia: null,
      mensaje: 'Menos de 3 historias: poco para sostener el interés y llegar a la acción.',
    })
  if (n > 9)
    h.push({
      nivel: 'aviso',
      historia: null,
      mensaje: `${n} historias: pasadas las 7-9 el abandono se dispara. Parte la secuencia en dos.`,
    })

  const gancho = specs[0]
  const pg = palabras(gancho.titulo ?? gancho.texto)
  if (pg > MAX_PALABRAS_GANCHO)
    h.push({
      nivel: 'aviso',
      historia: 1,
      mensaje: `El gancho tiene ${pg} palabras: en 1,5 s no se lee. Déjalo en ${MAX_PALABRAS_GANCHO} o menos.`,
    })
  if (!gancho.titulo)
    h.push({
      nivel: 'aviso',
      historia: 1,
      mensaje: 'La primera historia no tiene titular: el gancho tiene que ser lo primero que se lee.',
    })
  else if (!gancho.acento)
    h.push({ nivel: 'aviso', historia: 1, mensaje: 'Resalta una palabra del gancho: da jerarquía en un vistazo.' })

  specs.forEach((s, i) => {
    const seg = segundosDeLectura(s)
    if (seg > SEGUNDOS_POR_HISTORIA)
      h.push({
        nivel: 'aviso',
        historia: i + 1,
        mensaje: `Se tarda ≈${seg} s en leer y la historia dura ${SEGUNDOS_POR_HISTORIA}: acórtala o divídela.`,
      })
    const emojis = (textoDeHistoria(s).match(EMOJI) ?? []).length
    if (emojis > 2)
      h.push({ nivel: 'aviso', historia: i + 1, mensaje: `${emojis} emojis: máximo 1 o 2, y solo con función.` })
  })

  const ultima = specs[n - 1]
  const tieneAccion =
    ultima.layout === 'sticker' || ultima.sticker !== undefined || ACCION.test(textoDeHistoria(ultima))
  if (n > 1 && !tieneAccion)
    h.push({
      nivel: 'aviso',
      historia: n,
      mensaje: 'La última historia no pide una acción clara (palabra clave por mensaje, pregunta o sticker).',
    })

  for (let i = 2; i < n; i++)
    if (specs[i].layout === specs[i - 1].layout && specs[i].layout === specs[i - 2].layout) {
      h.push({
        nivel: 'aviso',
        historia: i + 1,
        mensaje: `Tres historias seguidas con la misma plantilla (${specs[i].layout}): alterna para mantener el ritmo.`,
      })
      break
    }

  if (!opciones.hayMedios && n >= 3)
    h.push({
      nivel: 'aviso',
      historia: null,
      mensaje: 'Sin fotos ni vídeos de la persona: con fondo liso se pierde cercanía y autoridad. Sube material real.',
    })
  return h
}
