import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { googleRedirectUri } from '@/lib/google/oauth'
import {
  borrarAjustePlataforma,
  definicionDeAjuste,
  estadoAjustesPlataforma,
  guardarAjustePlataforma,
} from '@/lib/platform/settings'

export const runtime = 'nodejs'

/**
 * Ajustes GLOBALES de la plataforma (cliente OAuth de Google, secreto del webhook de onboarding…).
 * Solo super admin de plataforma: ni un admin de subcuenta llega aquí. Nunca devuelve un secreto.
 * Cada cambio queda en `audit_logs` con quién y qué clave (jamás el valor).
 */
async function requerirSuperAdmin(tenant: string) {
  const t = await requireTenant(tenant)
  if ('error' in t) return { ok: false as const, res: t.error }
  if (!t.isSuperAdmin) {
    return {
      ok: false as const,
      res: NextResponse.json(
        { error: 'Solo el super admin de plataforma puede gestionar ajustes globales' },
        { status: 403 }
      ),
    }
  }
  return { ok: true as const, t }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requerirSuperAdmin(tenant)
  if (!auth.ok) return auth.res
  const estado = await estadoAjustesPlataforma()
  return NextResponse.json({
    ...estado,
    // URI que hay que registrar tal cual en Google Cloud.
    googleRedirectUri: googleRedirectUri(),
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requerirSuperAdmin(tenant)
  if (!auth.ok) return auth.res
  const body = (await req.json().catch(() => ({}))) as { key?: string; value?: string; action?: 'guardar' | 'borrar' }
  const key = String(body.key || '')
  if (!definicionDeAjuste(key)) return NextResponse.json({ error: 'Ajuste desconocido' }, { status: 400 })

  const resultado =
    body.action === 'borrar'
      ? await borrarAjustePlataforma(key)
      : await guardarAjustePlataforma(key, String(body.value ?? ''), auth.t.userId)
  if (!resultado.ok) return NextResponse.json({ error: resultado.error }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error: auditErr } = await sb.from('audit_logs').insert({
    tenant_id: auth.t.tenantId,
    actor_user_id: auth.t.userId,
    entity_type: 'platform_setting',
    entity_id: key,
    action: body.action === 'borrar' ? 'borrar' : 'guardar',
    new_values: { key },
  })
  if (auditErr) console.error('[platform/settings] no se pudo registrar en audit_logs:', auditErr.message)

  return NextResponse.json({ ok: true, ...(await estadoAjustesPlataforma()) })
}
