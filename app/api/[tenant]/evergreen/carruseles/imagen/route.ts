import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getCarruselUser } from '@/lib/carruseles/auth'
import { requireTenant } from '@/lib/auth/requireTenant'
import { addSlide, getBrand, getProject } from '@/lib/carruseles/store'
import { getTenantConfigWithFallback } from '@/lib/config'
import {
  construirPromptVisual,
  generarImagen,
  ImageError,
  IMAGE_PROVIDERS,
  proveedoresDisponibles,
  type ImageProvider,
  type TipoPieza,
} from '@/lib/ai/imagenes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'carrusel-uploads'
const TIPOS: TipoPieza[] = ['carrusel', 'flyer', 'historia']

/** Qué proveedores de imagen tiene conectados esta subcuenta (sin exponer ninguna clave). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const user = await getCarruselUser()
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const cfg = await getTenantConfigWithFallback(t.tenantId, true)
  return NextResponse.json({ disponibles: proveedoresDisponibles(cfg) })
}

/**
 * Genera una imagen con IA (Gemini u OpenAI), la guarda en el almacenamiento del módulo y, si se pasa
 * `projectId` y `comoSlide`, la añade como slide a pantalla completa. El prompt lo construye el servidor
 * con la marca de la subcuenta: la pantalla solo aporta la idea y el texto que debe salir en la imagen.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const user = await getCarruselUser()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const idea = typeof body.idea === 'string' ? body.idea.trim() : ''
    if (!idea || idea.length > 1500)
      return NextResponse.json({ error: 'Describe la imagen (máx. 1500 caracteres).' }, { status: 400 })
    const textoEnImagen = typeof body.textoEnImagen === 'string' ? body.textoEnImagen.trim().slice(0, 120) : undefined
    const tipo: TipoPieza = TIPOS.includes(body.tipo) ? body.tipo : 'carrusel'
    const preferido: ImageProvider | undefined = IMAGE_PROVIDERS.includes(body.proveedor) ? body.proveedor : undefined
    const projectId = typeof body.projectId === 'string' ? body.projectId : ''
    const comoSlide = body.comoSlide === true

    const project = projectId ? await getProject(t.tenantId, projectId) : null
    if (projectId && !project) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
    // Historia = 9:16 salvo que el proyecto ya tenga formato; el formato del proyecto manda.
    const formato = project?.aspectRatio ?? (tipo === 'historia' ? '9:16' : '4:5')

    const cfg = await getTenantConfigWithFallback(t.tenantId, true)
    if (!proveedoresDisponibles(cfg).length) {
      return NextResponse.json(
        { error: 'No hay ningún proveedor de imágenes conectado. Conecta Gemini u OpenAI en Ajustes → Integraciones.' },
        { status: 503 }
      )
    }
    const brand = await getBrand(t.tenantId)
    const prompt = construirPromptVisual({
      tipo,
      idea,
      textoEnImagen,
      marca: {
        nombre: brand.name || undefined,
        colores: Object.values(brand.colors),
        estilo: brand.styleKeywords.join(', ') || undefined,
      },
    })

    const imagen = await generarImagen({ prompt, formato, preferido }, cfg)
    const ext = imagen.mime.includes('jpeg') ? 'jpg' : imagen.mime.includes('webp') ? 'webp' : 'png'
    const key = `${tenant}/generated/${crypto.randomUUID()}.${ext}`
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    })
    const { error } = await sb.storage
      .from(BUCKET)
      .upload(key, Buffer.from(imagen.base64, 'base64'), { contentType: imagen.mime, upsert: false })
    if (error)
      return NextResponse.json(
        { error: `La imagen se generó pero no se pudo guardar: ${error.message}` },
        { status: 500 }
      )
    const url = sb.storage.from(BUCKET).getPublicUrl(key).data.publicUrl

    let slideId: string | null = null
    if (project && comoSlide) {
      const slide = await addSlide(
        t.tenantId,
        project.id,
        `<div style="width:100%;height:100%;background:url('${url}') center/cover no-repeat"></div>`,
        `Imagen IA (${imagen.proveedor}): ${idea.slice(0, 80)}`
      )
      if (!slide)
        return NextResponse.json(
          { error: 'La imagen se guardó, pero el proyecto ya tiene el máximo de slides.', url },
          { status: 409 }
        )
      slideId = slide.id
    }
    return NextResponse.json({
      url,
      proveedor: imagen.proveedor,
      modelo: imagen.modelo,
      fallbackReason: imagen.fallbackReason ?? null,
      slideId,
    })
  } catch (err) {
    if (err instanceof ImageError) return NextResponse.json({ error: err.message }, { status: 502 })
    console.error('[api/carruseles/imagen POST]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
