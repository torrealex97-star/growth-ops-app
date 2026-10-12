import { NextResponse } from 'next/server'
import { ipDe, limitar } from '@/lib/security/rate-limit'

const SHORTCODE = /^[A-Za-z0-9_-]{3,80}$/
const SAFE_IMAGE_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i
const CACHE = 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=7776000'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const FETCH_HEADERS = {
  Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  'User-Agent': 'GrowthOps-ThumbnailResolver/1.0',
}

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get('code')?.trim() || ''
  if (!SHORTCODE.test(code)) {
    return NextResponse.json({ error: 'Código de publicación no válido' }, { status: 400 })
  }

  const limit = limitar(`instagram-thumbnail:${ipDe(request.headers)}`, 240, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Demasiadas solicitudes' },
      { status: 429, headers: { 'Retry-After': String(limit.reintentarEnSeg), 'Cache-Control': 'no-store' } }
    )
  }

  try {
    const response = await fetch(`https://www.instagram.com/p/${code}/media/?size=l`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(4_000),
      headers: FETCH_HEADERS,
    })
    const location = response.headers.get('location')
    if (!location) {
      return NextResponse.json(
        { error: 'Miniatura no disponible' },
        { status: 404, headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } }
      )
    }

    const target = new URL(location, 'https://www.instagram.com')
    if (target.protocol !== 'https:' || !SAFE_IMAGE_HOST.test(target.hostname)) {
      return NextResponse.json({ error: 'Destino de miniatura no permitido' }, { status: 502 })
    }

    // Meta marca estas imágenes como CORP same-origin: una redirección funciona al
    // abrirla como página, pero el navegador la bloquea dentro de <img>. Servimos
    // únicamente el thumbnail (nunca el vídeo) y dejamos que el CDN de Vercel lo
    // conserve durante 30 días para no repetir tráfico ni ejecuciones.
    const image = await fetch(target, {
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
      headers: FETCH_HEADERS,
    })
    const contentType = image.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() || ''
    const contentLength = Number(image.headers.get('content-length') || 0)
    if (!image.ok || !contentType.startsWith('image/') || (contentLength > 0 && contentLength > MAX_IMAGE_BYTES)) {
      return NextResponse.json(
        { error: 'Miniatura no disponible' },
        { status: 404, headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } }
      )
    }

    return new NextResponse(image.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': CACHE,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'Miniatura temporalmente no disponible' },
      { status: 503, headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60' } }
    )
  }
}
