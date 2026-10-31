import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getCarruselUser } from '@/lib/carruseles/auth'
import { cargarSenalesVozCliente, VENTANA_DIAS } from '@/lib/insights/cargar-voz-cliente'
import { analizarVozCliente } from '@/lib/insights/voz-cliente'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Voz del cliente para decidir contenido: temas que repiten prospectos y clientes (objeciones de
 * llamadas, formularios de aplicación y feedback) con ideas de contenido por tema. Mismo permiso que el
 * módulo de contenido (marketing/dirección): las citas salen anonimizadas pero parten de datos personales.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const user = await getCarruselUser()
    if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false },
    })
    const carga = await cargarSenalesVozCliente(sb, t.tenantId)
    return NextResponse.json(
      {
        ...analizarVozCliente(carga.senales),
        fuentes: carga.fuentes,
        errores: carga.errores,
        ventanaDias: VENTANA_DIAS,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (err) {
    console.error('[api/insights/voz-cliente GET]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
