import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCarruselUser } from '@/lib/carruseles/auth'
import { requireTenant } from '@/lib/auth/requireTenant'
import { addReferenceImage } from '@/lib/carruseles/store'
import { MAX_IMAGEN, MAX_VIDEO, MIME_IMAGEN, MIME_VIDEO, subirAlBucket } from '@/lib/carruseles/almacen'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const user = await getCarruselUser()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const form = await req.formData().catch(() => null)
    if (!form) return NextResponse.json({ error: 'Form inválido' }, { status: 400 })
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'file requerido' }, { status: 400 })
    const esVideo = MIME_VIDEO.includes(file.type)
    if (!esVideo && !MIME_IMAGEN.includes(file.type))
      return NextResponse.json(
        { error: 'Formato no soportado (imágenes PNG/JPG/WEBP o vídeos MP4/WEBM/MOV)' },
        { status: 400 }
      )
    if (file.size > (esVideo ? MAX_VIDEO : MAX_IMAGEN))
      return NextResponse.json(
        { error: esVideo ? 'El vídeo pesa más de 50 MB' : 'La imagen pesa más de 15 MB' },
        { status: 400 }
      )

    const projectId = (form.get('projectId') as string) || ''
    const purpose = String(form.get('purpose') || 'reference').replace(/[^a-z-]/g, '') || 'reference'

    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const key = `${tenant}/${purpose}/${crypto.randomUUID()}.${ext}`
    const buf = Buffer.from(await file.arrayBuffer())

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    })
    const { error, url } = await subirAlBucket(sb, key, buf, file.type)
    if (error) return NextResponse.json({ error }, { status: 500 })

    if (purpose === 'reference' && projectId) {
      const image = { id: crypto.randomUUID(), url, name: file.name, addedAt: new Date().toISOString() }
      await addReferenceImage(t.tenantId, projectId, image)
      return NextResponse.json(image)
    }

    return NextResponse.json({ url, name: file.name })
  } catch (err) {
    console.error('[api/carruseles/upload POST]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
