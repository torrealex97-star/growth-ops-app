import { NextResponse } from 'next/server'
import { ipDe, limitar } from '@/lib/security/rate-limit'

const SHORTCODE = /^[A-Za-z0-9_-]{3,80}$/
const SAFE_IMAGE_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/i
const CACHE = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'

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
      headers: {
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'User-Agent': 'GrowthOps-ThumbnailResolver/1.0',
      },
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

    return new NextResponse(null, {
      status: 307,
      headers: {
        Location: target.toString(),
        'Cache-Control': CACHE,
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'Miniatura temporalmente no disponible' },
      { status: 503, headers: { 'Cache-Control': 'public, max-age=30, s-maxage=60' } }
    )
  }
}
