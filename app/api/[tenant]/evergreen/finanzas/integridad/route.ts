import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { auditarIntegridad } from '@/lib/finance/integrityAudit'
import type { AuditCobro, AuditCuota, AuditPago, AuditVenta } from '@/lib/finance/integrityAudit'

export const runtime = 'nodejs'
export const maxDuration = 30

const DIAS = 120
const LIMITE = 3000

// Auditoría de integridad app↔Stripe (solo lectura). Mide primero y corrige después: devuelve hallazgos,
// no toca datos. Ventana acotada y columnas mínimas (docs/FREE_TIER_OPERATIONS.md).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error
  if (!session.isSuperAdmin && !['admin', 'director'].includes(session.role ?? ''))
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    const desde = new Date(Date.now() - DIAS * 86400000).toISOString()
    const t = session.tenantId
    const [cobros, pagos, cuotas, ventas, refunds] = await Promise.all([
      sb
        .from('collections')
        .select('id,sale_id,gross_amount,collected_at,status,payment_reference,processing_fee')
        .eq('tenant_id', t)
        .gte('collected_at', desde)
        .limit(LIMITE),
      sb
        .from('stripe_payments')
        .select('payment_id,charge_id,customer_email,amount,refunded_amount,stripe_fee,status,paid_at')
        .eq('tenant_id', t)
        .gte('paid_at', desde)
        .limit(LIMITE),
      sb
        .from('sale_expected_installments')
        .select('id,sale_id,due_date,expected_gross_amount,status')
        .eq('tenant_id', t)
        .in('status', ['pending', 'overdue'])
        .limit(LIMITE),
      sb
        .from('sales')
        .select('id,contact_id,status,gross_amount,payment_plans(method)')
        .eq('tenant_id', t)
        .eq('status', 'active')
        .limit(LIMITE),
      sb.from('refunds').select('collection_id').eq('tenant_id', t).limit(LIMITE),
    ])
    const error = [cobros, pagos, cuotas, ventas, refunds].find((r) => r.error)?.error
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const hallazgos = auditarIntegridad({
      hoy: new Date().toISOString().slice(0, 10),
      cobros: (cobros.data ?? []) as AuditCobro[],
      pagos: (pagos.data ?? []) as AuditPago[],
      cuotas: (cuotas.data ?? []) as AuditCuota[],
      ventas: (ventas.data ?? []).map((v) => {
        const plan = v.payment_plans as { method?: string | null } | { method?: string | null }[] | null
        return {
          id: v.id,
          contact_id: v.contact_id,
          status: v.status,
          gross_amount: v.gross_amount,
          method: Array.isArray(plan) ? (plan[0]?.method ?? null) : (plan?.method ?? null),
        } as AuditVenta
      }),
      refundCobroIds: new Set((refunds.data ?? []).map((r) => r.collection_id as string)),
    })
    const truncado = [cobros, pagos, cuotas, ventas].some((r) => (r.data?.length ?? 0) >= LIMITE)
    return NextResponse.json({ ok: hallazgos.length === 0, truncado, total: hallazgos.length, hallazgos })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo auditar' }, { status: 500 })
  }
}
