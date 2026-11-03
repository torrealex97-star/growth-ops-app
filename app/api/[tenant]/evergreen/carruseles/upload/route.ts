import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCarruselUser } from '@/lib/carruseles/auth'
import { requireTenant } from '@/lib/auth/requireTenant'
import { addReferenceImage } from '@/lib/carruseles/store'
import { limpiarClave } from '@/lib/carruseles/historias/pedidos'
import { recomponerHistorias } from '@/lib/carruseles/recomponer'
import { BUCKET_CARRUSELES, rutaValida } from '@/lib/carruseles/almacen'

export const runtime = 'nodejs'

// POST { projectId, path, name, pedido? } → registra en el proyecto un archivo que el navegador YA subió al almacén
// (ver /upload-url). Solo se aceptan rutas que el servidor entregó para esta subcuenta.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    if (!(await getCarruselUser())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const body = (await req.json().catch(() => ({}))) as {
      projectId?: unknown
      path?: unknown
      name?: unknown
      pedido?: unknown
    }
    if (typeof body.projectId !== 'string' || !body.projectId || !rutaValida(body.path, tenant, 'referencias'))
      return NextResponse.json({ error: 'Faltan datos o la ruta no es válida' }, { status: 400 })

    const url = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    })
      .storage.from(BUCKET_CARRUSELES)
      .getPublicUrl(body.path).data.publicUrl
    // Material real que pidió una historia (captura de pago, testimonio…): se etiqueta con su clave y las historias
    // se recomponen solas con la imagen puesta, sin volver a llamar a la IA.
    const pedido = limpiarClave(body.pedido) || undefined
    const name = typeof body.name === 'string' ? body.name.slice(0, 120) : 'archivo'
    const image = { id: crypto.randomUUID(), url, name, addedAt: new Date().toISOString(), pedido }
    if (!(await addReferenceImage(t.tenantId, body.projectId, image)))
      return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
    const recompuestas = pedido ? await recomponerHistorias(t.tenantId, body.projectId).catch(() => null) : null
    return NextResponse.json({ ...image, recompuestas: recompuestas?.actualizadas ?? 0 })
  } catch (err) {
    console.error('[api/carruseles/upload POST]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
