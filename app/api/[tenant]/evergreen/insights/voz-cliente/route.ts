import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { leerVozCliente } from '@/lib/insights/voz-cliente-datos'

export const runtime = 'nodejs'
export const maxDuration = 30

// GET ?dias=90 → qué dicen los clientes potenciales y los clientes (temas medidos + ideas de
// contenido). Los porcentajes llevan su base. Las citas literales (anonimizadas) solo las ve
// admin/director; el resto recibe únicamente los recuentos.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  const dias = Math.min(365, Math.max(7, Number(req.nextUrl.searchParams.get('dias')) || 90))
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  try {
    const conCitas = ['admin', 'director'].includes(auth.role ?? '')
    return NextResponse.json(await leerVozCliente(sb, auth.tenantId, { dias, conCitas }))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 })
  }
}
