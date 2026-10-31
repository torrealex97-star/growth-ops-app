import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import {
  aplicarPlantilla,
  borrarPieza,
  copiarContenido,
  crearPieza,
  editarPieza,
  listarContenido,
  type DatosPieza,
} from '@/lib/launch/contenido'

export const runtime = 'nodejs'

const svc = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET ?launch=<uuid> → piezas de ese lanzamiento (calendario de nutrición + descargables).
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  const launch = req.nextUrl.searchParams.get('launch') ?? ''
  if (!UUID.test(launch)) return NextResponse.json({ error: 'Falta el lanzamiento' }, { status: 400 })
  try {
    return NextResponse.json({
      piezas: await listarContenido(svc(), auth.tenantId, launch),
      // La pantalla oculta el formulario a quien no puede guardar (el POST lo vuelve a comprobar).
      puedeEditar: ['admin', 'director'].includes(auth.role ?? ''),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}

// POST { accion: 'crear'|'editar'|'borrar'|'copiar', ... } — solo admin/director.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!['admin', 'director'].includes(auth.role ?? '')) {
    return NextResponse.json({ error: 'Solo admin o director pueden editar el contenido' }, { status: 403 })
  }
  let body: { accion?: string; launchId?: string; id?: string; origen?: string; datos?: DatosPieza }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const ok = (v?: string) => typeof v === 'string' && UUID.test(v)
  const sb = svc()
  try {
    if (body.accion === 'crear') {
      if (!ok(body.launchId)) return NextResponse.json({ error: 'Falta el lanzamiento' }, { status: 400 })
      const id = await crearPieza(sb, auth.tenantId, body.launchId as string, body.datos ?? {}, auth.userId)
      return NextResponse.json({ ok: true, id })
    }
    if (body.accion === 'editar') {
      if (!ok(body.id)) return NextResponse.json({ error: 'Falta la pieza' }, { status: 400 })
      await editarPieza(sb, auth.tenantId, body.id as string, body.datos ?? {})
      return NextResponse.json({ ok: true })
    }
    if (body.accion === 'borrar') {
      if (!ok(body.id)) return NextResponse.json({ error: 'Falta la pieza' }, { status: 400 })
      await borrarPieza(sb, auth.tenantId, body.id as string)
      return NextResponse.json({ ok: true })
    }
    if (body.accion === 'plantilla') {
      if (!ok(body.launchId)) return NextResponse.json({ error: 'Falta el lanzamiento' }, { status: 400 })
      const añadidas = await aplicarPlantilla(sb, auth.tenantId, body.launchId as string, auth.userId)
      return NextResponse.json({ ok: true, añadidas })
    }
    if (body.accion === 'copiar') {
      if (!ok(body.origen) || !ok(body.launchId))
        return NextResponse.json({ error: 'Faltan lanzamientos' }, { status: 400 })
      const copiadas = await copiarContenido(
        sb,
        auth.tenantId,
        body.origen as string,
        body.launchId as string,
        auth.userId
      )
      return NextResponse.json({ ok: true, copiadas })
    }
    return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo ejecutar la acción' },
      { status: 400 }
    )
  }
}
