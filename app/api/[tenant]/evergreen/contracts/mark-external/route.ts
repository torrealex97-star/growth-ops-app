import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'

export const runtime = 'nodejs'

const ALLOWED_ROLES = new Set(['admin', 'director', 'manager'])

/**
 * Da por firmado un contrato que la persona firmó FUERA de la app (papel, otra plataforma), sin
 * obligar a subir el PDF. Queda registrado como `firmado_externamente`, con quién y cuándo, y activa al
 * colaborador. Para adjuntar además el PDF existe /contracts/attach.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    if (!t.role || !ALLOWED_ROLES.has(t.role) || !t.administraTenant) {
      return NextResponse.json({ error: 'No tienes permiso para dar un contrato por firmado' }, { status: 403 })
    }
    const body = (await req.json().catch(() => ({}))) as { contractId?: string }
    const contractId = String(body.contractId ?? '').trim()
    if (!contractId) return NextResponse.json({ error: 'Falta el contrato' }, { status: 400 })

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: contract, error: readErr } = await sb
      .from('contracts')
      .select('id, kind, user_id, status, signer_data')
      .eq('id', contractId)
      .eq('tenant_id', t.tenantId)
      .maybeSingle()
    if (readErr || !contract) return NextResponse.json({ error: 'Contrato no encontrado' }, { status: 404 })
    if (contract.status === 'firmado') return NextResponse.json({ ok: true, yaFirmado: true })

    const ahora = new Date().toISOString()
    const { error: upErr } = await sb
      .from('contracts')
      .update({
        status: 'firmado',
        signed_at: ahora,
        signer_data: {
          ...((contract.signer_data ?? {}) as Record<string, unknown>),
          source: 'firmado_externamente',
          marked_by: t.userId,
          marked_at: ahora,
        },
      })
      .eq('id', contract.id)
      .eq('tenant_id', t.tenantId)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    if (contract.kind === 'equipo' && contract.user_id) {
      const { error: actErr } = await sb
        .from('collaborator_profiles')
        .update({ status: 'active', updated_at: ahora })
        .eq('tenant_id', t.tenantId)
        .eq('user_id', contract.user_id)
        .in('status', ['invited', 'pending_contract'])
      if (actErr) console.error('[contracts/mark-external] no se pudo activar al colaborador:', actErr.message)
    }
    const { error: auditErr } = await sb.from('audit_logs').insert({
      tenant_id: t.tenantId,
      actor_user_id: t.userId,
      entity_type: 'contract',
      entity_id: contract.id,
      action: 'mark_signed_externally',
      new_values: { source: 'firmado_externamente', kind: contract.kind },
    })
    if (auditErr) console.error('[contracts/mark-external] no se pudo registrar audit_logs:', auditErr.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error interno' }, { status: 500 })
  }
}
