import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { esc, informeAHtml, type InformeExportable } from '@/lib/launch/informe-html'
import { guardarInforme, leerGuardado, listarGuardados, type Momento } from '@/lib/launch/informe-guardado'

export const runtime = 'nodejs'
export const maxDuration = 30

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const svc = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

// GET ?launch=<uuid>           → lista de informes guardados de ese lanzamiento
// GET ?id=<uuid>&formato=html  → descarga el informe guardado como HTML autocontenido
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  const sp = req.nextUrl.searchParams
  try {
    const id = sp.get('id')
    if (id) {
      if (!UUID.test(id)) return NextResponse.json({ error: 'Informe no válido' }, { status: 400 })
      const g = await leerGuardado(svc(), auth.tenantId, id)
      if (!g) return NextResponse.json({ error: 'Informe no encontrado' }, { status: 404 })
      const html = informeAHtml(g.datos as InformeExportable, { momento: g.momento, generadoAt: g.generado_at })
      return new NextResponse(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Disposition': `attachment; filename="informe-${esc(g.momento)}-${g.generado_at.slice(0, 10)}.html"`,
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }
    const launch = sp.get('launch') ?? ''
    if (!UUID.test(launch)) return NextResponse.json({ error: 'Falta el lanzamiento' }, { status: 400 })
    return NextResponse.json({
      guardados: await listarGuardados(svc(), auth.tenantId, launch),
      puedeGuardar: ['admin', 'director'].includes(auth.role ?? ''),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}

// POST { launchId, momento: 'intermedio'|'final' } — solo admin/director.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!['admin', 'director'].includes(auth.role ?? '')) {
    return NextResponse.json({ error: 'Solo admin o director pueden guardar informes' }, { status: 403 })
  }
  let body: { launchId?: string; momento?: Momento }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  if (!body.launchId || !UUID.test(body.launchId) || !body.momento)
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 })
  try {
    const cfg = await getTenantConfigWithFallback(auth.tenantId, true)
    const id = await guardarInforme(svc(), auth.tenantId, body.launchId, body.momento, auth.userId, cfg)
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo guardar' }, { status: 400 })
  }
}
