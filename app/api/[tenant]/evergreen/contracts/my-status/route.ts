import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// Estado del contrato de equipo del usuario logueado. Se usa para bloquear el
// acceso al panel a closer/setter/afiliado a quien se le ENVIÓ un contrato desde la app y aún no lo ha firmado
// (`bloqueaAcceso`). Quien no tiene contrato enviado no se bloquea: pudo firmar fuera de la app.
// Necesita el service role porque la RLS de `contracts` no deja a esos roles
// leer la tabla (solo la lee liderazgo/csm/gestoría).
export async function GET(_req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const sb = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data } = await sb
      .from('contracts')
      .select('status, signing_token, created_at')
      .eq('user_id', t.userId)
      .eq('kind', 'equipo')
      .eq('tenant_id', t.tenantId)
      .order('created_at', { ascending: false })

    const list = (data ?? []) as { status: string; signing_token: string | null }[]
    const hasSigned = list.some((c) => c.status === 'firmado')
    const pending = list.find((c) => c.status !== 'firmado' && c.signing_token)
    // SOLO bloquea el acceso quien tiene un contrato ENVIADO desde la app (con enlace de firma) y sin
    // firmar. Quien no tiene ninguno —o solo un borrador— probablemente firmó por otra vía (papel, otra
    // plataforma): dejarlo fuera por no constar aquí sería un bloqueo sin motivo.
    const enviadoSinFirmar = list.find((c) => c.status === 'enviado' && c.signing_token)
    const bloqueaAcceso = !hasSigned && !!enviadoSinFirmar

    return NextResponse.json({
      hasSigned,
      hasContract: list.length > 0,
      pendingToken: pending?.signing_token ?? null,
      bloqueaAcceso,
      // El enlace que se muestra en el bloqueo es el del contrato enviado, no el de un borrador.
      signingToken: enviadoSinFirmar?.signing_token ?? null,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
