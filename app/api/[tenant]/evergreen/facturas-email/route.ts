import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

// El histórico importado desde Gmail sigue disponible para validación y auditoría. La lectura de
// buzones nuevos se retiró porque exige scopes restringidos de Gmail y una evaluación CASA. Las
// facturas nuevas entran por subida o reenvío, sin conceder acceso al correo del cliente.

function serviceClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function requireManage(tenantSlug: string) {
  const session = await requireTenant(tenantSlug)
  if ('error' in session) return { ok: false as const, res: session.error }
  if (!session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return {
      ok: false as const,
      res: NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 }),
    }
  }
  return { ok: true as const, session }
}

// Lista del histórico, por defecto lo pendiente de validar.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const session = await requireTenant(tenant)
    if ('error' in session) return session.error

    const status = new URL(req.url).searchParams.get('status') || 'pendiente_validacion'
    const { data, error } = await serviceClient()
      .from('email_invoices')
      .select('id,from_email,subject,received_at,file_name,size_bytes,storage_path,status,expense_id,created_at')
      .eq('tenant_id', session.tenantId)
      .eq('status', status)
      .order('received_at', { ascending: false, nullsFirst: false })
      .limit(200)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ items: data ?? [] })
  } catch (error) {
    console.error('[api/facturas-email GET]', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}

// Se conserva la ruta para que clientes antiguos reciban una explicación explícita y no reintenten.
export async function POST() {
  return NextResponse.json(
    { error: 'La importación desde Gmail ya no está disponible. Sube o reenvía la factura.' },
    { status: 410 }
  )
}

// Validar o descartar el histórico. Vincular a un gasto solo es posible al validar.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = await requireManage(tenant)
    if (!auth.ok) return auth.res
    const { session } = auth

    const body = (await req.json().catch(() => ({}))) as {
      id?: string
      status?: string
      expenseId?: string | null
      notes?: string
    }
    if (!body.id) return NextResponse.json({ error: 'Falta el id' }, { status: 400 })
    if (!body.status || !['validada', 'descartada'].includes(body.status)) {
      return NextResponse.json({ error: 'El estado debe ser validada o descartada' }, { status: 400 })
    }

    const { data, error } = await serviceClient()
      .from('email_invoices')
      .update({
        status: body.status,
        validated_by: session.userId,
        validated_at: new Date().toISOString(),
        expense_id: body.status === 'validada' ? body.expenseId || null : null,
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      })
      .eq('tenant_id', session.tenantId)
      .eq('id', body.id)
      .select('id')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'No se encontró esa factura en esta subcuenta' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[api/facturas-email PATCH]', error)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
