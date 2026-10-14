import { createClient } from '@supabase/supabase-js'
import { ambitosFaltantes, googleCredentials, SCOPES } from '@/lib/google/oauth'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { decryptSecret } from '@/lib/config'
import { revokeGoogleToken, type GoogleProvider } from '@/lib/google/oauth'

export const runtime = 'nodejs'

const ADMIN_PROVIDERS = new Set<GoogleProvider>(['ga4', 'youtube', 'youtube_publish'])

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function requireManage(tenant: string) {
  const session = await requireTenant(tenant)
  if ('error' in session) return { ok: false as const, response: session.error }
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 }),
    }
  }
  return { ok: true as const, session }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireManage(tenant)
  if (!auth.ok) return auth.response
  const sb = serviceClient()
  const { data, error } = await sb
    .from('google_oauth_connections')
    .select('provider,google_email,status,scopes,ga4_property_id,last_sync_at,last_error,reauth_required_at,updated_at')
    .eq('tenant_id', auth.session.tenantId)
    .in('provider', ['ga4', 'youtube', 'youtube_publish'])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // AUTOCURACIÓN: una conexión marcada «Faltan permisos concedidos» por el fallo antiguo de la
  // comparación (Google devuelve `email` como URL completa) ya tiene todos sus permisos guardados en
  // `scopes`. Se recalcula con la comparación corregida y, si no falta nada, se repara sin obligar a
  // reconectar. Si de verdad falta un permiso, se deja tal cual.
  const conexiones = []
  for (const c of data ?? []) {
    const fila = c as { provider: GoogleProvider; status: string; last_error: string | null; scopes: string[] | null }
    if (
      fila.status === 'error' &&
      (fila.last_error || '').startsWith('Faltan permisos concedidos') &&
      Array.isArray(fila.scopes) &&
      ambitosFaltantes(SCOPES[fila.provider], fila.scopes.join(' ')).length === 0
    ) {
      const { error: upErr } = await sb
        .from('google_oauth_connections')
        .update({ status: 'conectada', last_error: null })
        .eq('tenant_id', auth.session.tenantId)
        .eq('provider', fila.provider)
      if (!upErr) {
        conexiones.push({ ...c, status: 'conectada', last_error: null })
        continue
      }
    }
    conexiones.push(c)
  }
  return NextResponse.json({
    configured: Boolean(await googleCredentials()),
    connections: conexiones,
  })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireManage(tenant)
  if (!auth.ok) return auth.response
  const provider = new URL(req.url).searchParams.get('provider') as GoogleProvider | null
  if (!provider || !ADMIN_PROVIDERS.has(provider)) {
    return NextResponse.json({ error: 'Servicio de Google no válido' }, { status: 400 })
  }

  const sb = serviceClient()
  const { data: connection, error: readError } = await sb
    .from('google_oauth_connections')
    .select('id,refresh_token')
    .eq('tenant_id', auth.session.tenantId)
    .eq('provider', provider)
    .maybeSingle()
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
  if (!connection) return NextResponse.json({ ok: true, disconnected: false })

  let revoked = false
  try {
    revoked = await revokeGoogleToken(decryptSecret(connection.refresh_token))
  } catch {
    // Un token indescifrable o ya revocado no debe impedir quitar una conexión inutilizable.
  }
  const { error: deleteError } = await sb
    .from('google_oauth_connections')
    .delete()
    .eq('id', connection.id)
    .eq('tenant_id', auth.session.tenantId)
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })
  return NextResponse.json({ ok: true, disconnected: true, revoked })
}
