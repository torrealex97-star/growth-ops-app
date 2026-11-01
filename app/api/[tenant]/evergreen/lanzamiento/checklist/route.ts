import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { listarMarcados, marcarItem } from '@/lib/launch/checklist'

export const runtime = 'nodejs'

const svc = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET ?launch=<uuid> → claves marcadas del checklist de ese lanzamiento.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  const launch = req.nextUrl.searchParams.get('launch') ?? ''
  if (!UUID.test(launch)) return NextResponse.json({ error: 'Falta el lanzamiento' }, { status: 400 })
  try {
    return NextResponse.json({
      marcados: await listarMarcados(svc(), auth.tenantId, launch),
      puedeEditar: ['admin', 'director'].includes(auth.role ?? ''),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}

// POST { launchId, key, hecho } — solo admin/director.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!['admin', 'director'].includes(auth.role ?? '')) {
    return NextResponse.json({ error: 'Solo admin o director pueden marcar el checklist' }, { status: 403 })
  }
  let body: { launchId?: string; key?: string; hecho?: boolean }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  if (!body.launchId || !UUID.test(body.launchId) || typeof body.key !== 'string') {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 })
  }
  try {
    await marcarItem(svc(), auth.tenantId, body.launchId, body.key, body.hecho !== false, auth.userId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo guardar' }, { status: 400 })
  }
}
