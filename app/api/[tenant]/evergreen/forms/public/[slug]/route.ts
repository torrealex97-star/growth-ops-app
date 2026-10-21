import { NextRequest, NextResponse } from 'next/server'
import { stripForPublic } from '@/lib/forms/public'
import { loadPublishedForm, serviceClient } from '@/lib/forms/server'
import { ipDe, limitar } from '@/lib/security/rate-limit'

export const dynamic = 'force-dynamic'

// Config PÚBLICA de un formulario publicado (sin pesos de scoring). Sin sesión.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string; slug: string }> }) {
  const { tenant, slug } = await params
  const limite = limitar(`forms:cfg:${ipDe(req.headers)}`, 120, 60_000)
  if (!limite.ok) {
    return NextResponse.json({ error: 'Demasiadas peticiones' }, { status: 429, headers: { 'Retry-After': String(limite.reintentarEnSeg) } })
  }
  const loaded = await loadPublishedForm(serviceClient(), tenant, slug)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  const { form } = loaded
  return NextResponse.json(
    { name: form.name, version: form.version, config: stripForPublic(form.config) },
    { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } }
  )
}
