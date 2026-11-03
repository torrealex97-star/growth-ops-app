import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getCarruselUser } from '@/lib/carruseles/auth'
import {
  BUCKET_CARRUSELES,
  CARPETAS_SUBIDA,
  EXT_POR_MIME,
  asegurarBucket,
  validarArchivo,
  type CarpetaSubida,
} from '@/lib/carruseles/almacen'

export const runtime = 'nodejs'

const PUEDEN_EDITAR = ['admin', 'director', 'manager']

// POST { mime, size, carpeta } → { path, url, signedUrl }: valida el archivo y entrega una dirección de subida de un solo
// uso. El navegador sube DIRECTO al almacén (Vercel no admite cuerpos de más de ~4,5 MB) y luego registra la ruta.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!(await getCarruselUser())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { mime?: unknown; size?: unknown; carpeta?: unknown }
  const carpeta = body.carpeta as CarpetaSubida
  if (!(CARPETAS_SUBIDA as readonly unknown[]).includes(carpeta) || typeof body.mime !== 'string')
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 })
  // Los ejemplos definen el estilo de la subcuenta: solo liderazgo.
  if (carpeta === 'ejemplos' && !PUEDEN_EDITAR.includes(t.role ?? ''))
    return NextResponse.json({ error: 'Solo liderazgo puede gestionar los ejemplos' }, { status: 403 })
  const invalido = validarArchivo(body.mime, Number(body.size), carpeta)
  if (invalido) return NextResponse.json({ error: invalido }, { status: 400 })

  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    })
    const fallo = await asegurarBucket(sb)
    if (fallo) return NextResponse.json({ error: fallo }, { status: 500 })
    const path = `${tenant}/${carpeta}/${crypto.randomUUID()}.${EXT_POR_MIME[body.mime]}`
    const { data, error } = await sb.storage.from(BUCKET_CARRUSELES).createSignedUploadUrl(path)
    if (error || !data)
      return NextResponse.json({ error: error?.message ?? 'No se pudo preparar la subida' }, { status: 500 })
    return NextResponse.json({
      path,
      signedUrl: data.signedUrl,
      url: sb.storage.from(BUCKET_CARRUSELES).getPublicUrl(path).data.publicUrl,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
