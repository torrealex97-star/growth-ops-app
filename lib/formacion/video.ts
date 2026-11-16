/**
 * Vídeos de formación: la app NO aloja vídeo, solo guarda un enlace externo. Para no incrustar páginas
 * arbitrarias dentro de un `<iframe>` (phishing, tracking, contenido que cambia), se acepta únicamente una
 * lista blanca de proveedores y se reescribe SIEMPRE la URL a su forma embebible canónica. Módulo puro.
 */

export type ProveedorVideo = 'youtube' | 'loom' | 'wistia' | 'vimeo' | 'bunny'

export interface VideoEmbebible {
  proveedor: ProveedorVideo
  /** URL lista para `<iframe src>`, reconstruida por nosotros (nunca la cadena del usuario tal cual). */
  embedUrl: string
}

const ID = /^[A-Za-z0-9_-]{3,64}$/
const BUNNY_GUID = /^[0-9a-fA-F-]{16,64}$/

function urlSegura(entrada: string): URL | null {
  const texto = entrada.trim()
  if (!texto || texto.length > 600) return null
  let url: URL
  try {
    url = new URL(texto)
  } catch {
    return null
  }
  // Solo https: un iframe http se bloquearía como contenido mixto y abriría la puerta a MITM.
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  return url
}

function host(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '')
}

function ultimoSegmento(url: URL, despuesDe: string): string | null {
  const partes = url.pathname.split('/').filter(Boolean)
  const i = partes.indexOf(despuesDe)
  return i >= 0 && partes[i + 1] ? partes[i + 1] : null
}

/** Devuelve el vídeo embebible o `null` si la URL no es de un proveedor permitido o no tiene un id válido. */
export function parsearVideo(entrada: string): VideoEmbebible | null {
  const url = urlSegura(entrada)
  if (!url) return null
  const h = host(url)

  // YouTube: watch?v=ID, youtu.be/ID, /embed/ID, /shorts/ID. Se usa youtube-nocookie para no sembrar cookies.
  if (h === 'youtube.com' || h === 'm.youtube.com' || h === 'youtube-nocookie.com') {
    const id = url.searchParams.get('v') ?? ultimoSegmento(url, 'embed') ?? ultimoSegmento(url, 'shorts')
    return id && ID.test(id) ? { proveedor: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}` } : null
  }
  if (h === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0]
    return id && ID.test(id) ? { proveedor: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${id}` } : null
  }

  // Loom: loom.com/share/ID o loom.com/embed/ID
  if (h === 'loom.com') {
    const id = ultimoSegmento(url, 'share') ?? ultimoSegmento(url, 'embed')
    return id && ID.test(id) ? { proveedor: 'loom', embedUrl: `https://www.loom.com/embed/${id}` } : null
  }

  // Wistia: <cuenta>.wistia.com/medias/ID o fast.wistia.net/embed/iframe/ID
  if (h.endsWith('.wistia.com') || h === 'wistia.com') {
    const id = ultimoSegmento(url, 'medias')
    return id && ID.test(id) ? { proveedor: 'wistia', embedUrl: `https://fast.wistia.net/embed/iframe/${id}` } : null
  }
  if (h === 'fast.wistia.net') {
    const id = ultimoSegmento(url, 'iframe')
    return id && ID.test(id) ? { proveedor: 'wistia', embedUrl: `https://fast.wistia.net/embed/iframe/${id}` } : null
  }

  // Vimeo: vimeo.com/ID, vimeo.com/ID/HASH (no listado) o ?h=HASH, y player.vimeo.com/video/ID. El hash de un
  // vídeo no listado es imprescindible: sin él el reproductor da error de privacidad.
  if (h === 'vimeo.com' || h === 'player.vimeo.com') {
    const partes = url.pathname.split('/').filter(Boolean)
    const id = h === 'vimeo.com' ? partes[0] : ultimoSegmento(url, 'video')
    const hash = (h === 'vimeo.com' ? partes[1] : undefined) ?? url.searchParams.get('h') ?? undefined
    if (!id || !/^\d{4,15}$/.test(id)) return null
    if (hash !== undefined && !/^[0-9a-f]{6,20}$/i.test(hash)) return null
    return { proveedor: 'vimeo', embedUrl: `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ''}` }
  }

  // Bunny Stream: iframe.mediadelivery.net/embed|play/<libraryId>/<guid>
  if (h === 'iframe.mediadelivery.net') {
    const partes = url.pathname.split('/').filter(Boolean)
    const [modo, libreria, guid] = partes
    if ((modo === 'embed' || modo === 'play') && /^\d{1,10}$/.test(libreria ?? '') && BUNNY_GUID.test(guid ?? '')) {
      return { proveedor: 'bunny', embedUrl: `https://iframe.mediadelivery.net/embed/${libreria}/${guid}` }
    }
    return null
  }

  return null
}

export const PROVEEDORES_VIDEO: readonly ProveedorVideo[] = ['youtube', 'loom', 'wistia', 'vimeo', 'bunny']
