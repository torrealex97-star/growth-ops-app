const INSTAGRAM_HOST = /(^|\.)instagram\.com$/i
const MEDIA_PATHS = new Set(['p', 'reel', 'reels', 'tv'])
const SHORTCODE = /^[A-Za-z0-9_-]+$/

export function instagramThumbnailFromPermalink(permalink: string | null | undefined): string | null {
  if (!permalink) return null
  try {
    const url = new URL(permalink)
    if (!INSTAGRAM_HOST.test(url.hostname)) return null
    const parts = url.pathname.split('/').filter(Boolean)
    const kind = parts.findIndex((part) => MEDIA_PATHS.has(part.toLowerCase()))
    const shortcode = kind >= 0 ? parts[kind + 1] : null
    if (!shortcode || !SHORTCODE.test(shortcode)) return null
    // Este endpoint público resuelve una portada fresca y redirige a la CDN actual.
    // Evita proxy, almacenamiento y egress de Vercel para URLs firmadas que ya caducaron.
    return `https://www.instagram.com/p/${shortcode}/media/?size=l`
  } catch {
    return null
  }
}
