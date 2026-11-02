import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { cssDeFuentes } from '@/lib/carruseles/fuentes'

export const runtime = 'nodejs'

// Proxy de Google Fonts: devuelve el CSS con @font-face (woff2) para poder
// embeber las fuentes en el PNG exportado (html-to-image fontEmbedCSS).
export async function GET(req: NextRequest, { params: routeParams }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await routeParams
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const families = new URL(req.url).searchParams.get('families') || ''
  if (!families.trim()) return new NextResponse('', { headers: { 'Content-Type': 'text/css' } })

  try {
    const css = await cssDeFuentes(families.split(','))
    return new NextResponse(css, {
      headers: {
        'Content-Type': 'text/css',
        'Cache-Control': 'public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400',
      },
    })
  } catch {
    return new NextResponse('', { headers: { 'Content-Type': 'text/css' } })
  }
}
