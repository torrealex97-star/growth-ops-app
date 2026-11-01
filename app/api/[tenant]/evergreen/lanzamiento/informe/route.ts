import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { leerInforme } from '@/lib/launch/informe-datos'

export const runtime = 'nodejs'
export const maxDuration = 30

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET ?launch=<uuid> → informe DATA + ACCIONES del lanzamiento (solo agregados, sin PII).
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  const launch = req.nextUrl.searchParams.get('launch') ?? ''
  if (!UUID.test(launch)) return NextResponse.json({ error: 'Falta el lanzamiento' }, { status: 400 })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  try {
    const cfg = await getTenantConfigWithFallback(auth.tenantId, true)
    return NextResponse.json(await leerInforme(sb, auth.tenantId, launch, cfg))
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error'
    return NextResponse.json({ error: msg }, { status: msg === 'Lanzamiento no encontrado' ? 404 : 500 })
  }
}
