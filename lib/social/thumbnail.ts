const INSTAGRAM_HOST = /(^|\.)instagram\.com$/i
const MEDIA_PATHS = new Set(['p', 'reel', 'reels', 'tv'])
const SHORTCODE = /^[A-Za-z0-9_-]+$/
const THUMBNAIL_PROXY_VERSION = '2'

export function instagramThumbnailFromPermalink(permalink: string | null | undefined): string | null {
  if (!permalink) return null
  try {
    const url = new URL(permalink)
    if (!INSTAGRAM_HOST.test(url.hostname)) return null
    const parts = url.pathname.split('/').filter(Boolean)
    const kind = parts.findIndex((part) => MEDIA_PATHS.has(part.toLowerCase()))
    const shortcode = kind >= 0 ? parts[kind + 1] : null
    if (!shortcode || !SHORTCODE.test(shortcode)) return null
    // Este endpoint público permite resolver una portada fresca cuando la URL firmada almacenada ha caducado.
    return `https://www.instagram.com/p/${shortcode}/media/?size=l`
  } catch {
    return null
  }
}

export function instagramThumbnailResolverFromPermalink(permalink: string | null | undefined): string | null {
  const directUrl = instagramThumbnailFromPermalink(permalink)
  if (!directUrl) return null
  const shortcode = new URL(directUrl).pathname.split('/').filter(Boolean)[1]
  return shortcode
    ? `/api/social/instagram-thumbnail?code=${encodeURIComponent(shortcode)}&v=${THUMBNAIL_PROXY_VERSION}`
    : null
}
