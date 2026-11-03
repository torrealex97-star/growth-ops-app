import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { analizarFactura } from '@/lib/ai/invoice-analysis'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'
export const maxDuration = 60

// Recibe una factura (base64 + mediaType) y devuelve los datos extraídos.
// NO crea el gasto: la UI lo muestra como borrador para revisar y confirmar.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const { fileBase64, mediaType } = await req.json()
    if (!fileBase64 || !mediaType) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const role = t.role
    if (!['admin', 'director', 'manager'].includes(role || '')) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }

    // Misma lectura y conversión a EUR que usa la factura de comisiones del colaborador (lib/ai/invoice-analysis).
    const result = await analizarFactura(sb, t.tenantId, fileBase64, mediaType)

    // La extracción es una SUGERENCIA: el gasto que nazca de ella va siempre needs_review
    // y debe pasar por revisión humana antes de considerarse un dato confirmado.
    return NextResponse.json({ ok: true, extracted: result, needs_review: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
