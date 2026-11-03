import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import {
  clasificarImpago,
  type EstadoImpago,
  type IntentoFallido,
  type PagoStripeLite,
} from '@/lib/collaborators/panel'
import { resolverScopeColaborador } from '@/lib/collaborators/scope'
import { stripeGet } from '@/lib/stripe/client'

export const runtime = 'nodejs'
export const maxDuration = 30

// ESTADO EN STRIPE DE LAS CUOTAS VENCIDAS DE UNA COLABORADORA.
//
// El panel le enseña a quién le falta pagar y POR QUÉ (cobrado pero sin registrar / rechazado por el banco / sin
// intento), en vez de un «ajuste» opaco. Reglas de seguridad:
//  · solo una colaboradora ACTIVA, y solo para cuotas de ventas de contactos ATRIBUIDOS a ella (el cliente manda
//    ids, el servidor los vuelve a comprobar; lo que no es suyo se ignora, no se contesta);
//  · se devuelve solo el estado y el motivo, nunca el correo ni el id de Stripe del cliente;
//  · un fallo de Stripe degrada a «sin intento conocido»: nunca bloquea el panel ni inventa un impago.

const LOTE = 25
const MAX_IDS = 60

type Cuota = {
  id: string
  sale_id: string
  due_date: string | null
  expected_gross_amount: number | string
  status: string
}

async function enLotes<T>(ids: string[], leer: (lote: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += LOTE) {
    const { data, error } = await leer(ids.slice(i, i + LOTE))
    if (error) throw error
    out.push(...(data ?? []))
  }
  return out
}

async function intentoFallido(
  customerId: string,
  auth: { secretKey: string; accountId: string | null }
): Promise<IntentoFallido | null> {
  try {
    const res = await stripeGet<{
      data: {
        status: string
        created: number
        last_payment_error?: { code?: string; decline_code?: string; message?: string } | null
      }[]
    }>('payment_intents', new URLSearchParams({ customer: customerId, limit: '5' }), auth, 8_000)
    const fallo = res.data.find((p) => p.last_payment_error && p.status !== 'succeeded')
    if (!fallo?.last_payment_error) return null
    return {
      code: fallo.last_payment_error.code ?? null,
      declineCode: fallo.last_payment_error.decline_code ?? null,
      message: null, // el texto libre de Stripe va en inglés y puede traer datos: solo códigos
      fecha: new Date(fallo.created * 1000).toISOString(),
    }
  } catch {
    return null
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error

    const body = (await req.json().catch(() => null)) as { installmentIds?: unknown } | null
    const ids = Array.isArray(body?.installmentIds)
      ? [...new Set(body.installmentIds.filter((x): x is string => typeof x === 'string' && x.length < 64))].slice(
          0,
          MAX_IDS
        )
      : []
    if (ids.length === 0) return NextResponse.json({ ok: true, estados: {} })

    const sb: SupabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const scope = await resolverScopeColaborador(sb, t.userId, t.tenantId)
    if (scope.tipo !== 'collaborator') {
      return NextResponse.json({ error: 'Solo disponible para colaboradores' }, { status: 403 })
    }

    // 1) Cuotas pedidas → ventas → contacto, y de ahí solo las atribuidas a ESTA colaboradora.
    const cuotas = await enLotes<Cuota>(ids, (lote) =>
      sb
        .from('sale_expected_installments')
        .select('id, sale_id, due_date, expected_gross_amount, status')
        .in('id', lote)
    )
    const ventas = await enLotes<{ id: string; contact_id: string | null; tenant_id: string }>(
      [...new Set(cuotas.map((c) => c.sale_id))],
      (lote) => sb.from('sales').select('id, contact_id, tenant_id').in('id', lote).eq('tenant_id', t.tenantId)
    )
    const contactoDeVenta = new Map(ventas.map((v) => [v.id, v.contact_id]))
    const contactos = [...new Set(ventas.map((v) => v.contact_id).filter((x): x is string => !!x))]
    const atribuidos = new Set(
      (
        await enLotes<{ contact_id: string }>(contactos, (lote) =>
          sb
            .from('contact_attributions')
            .select('contact_id')
            .eq('tenant_id', t.tenantId)
            .eq('collaborator_id', scope.collaboratorId)
            .in('contact_id', lote)
        )
      ).map((r) => r.contact_id)
    )
    const propias = cuotas.filter((c) => {
      const contacto = contactoDeVenta.get(c.sale_id)
      return !!contacto && atribuidos.has(contacto) && c.status !== 'collected' && c.status !== 'cancelled'
    })

    // 2) Cliente de Stripe de cada contacto y sus pagos ya espejados.
    const clientes = await enLotes<{ contact_id: string | null; stripe_customer_id: string }>(
      [...new Set(propias.map((c) => contactoDeVenta.get(c.sale_id)!))],
      (lote) =>
        sb
          .from('stripe_customers')
          .select('contact_id, stripe_customer_id')
          .eq('tenant_id', t.tenantId)
          .in('contact_id', lote)
    )
    const clienteDeContacto = new Map(clientes.map((c) => [c.contact_id, c.stripe_customer_id]))
    const idsCliente = [...new Set(clientes.map((c) => c.stripe_customer_id))]
    const pagos = await enLotes<PagoStripeLite & { customer_id: string | null }>(idsCliente, (lote) =>
      sb
        .from('stripe_payments')
        .select('customer_id, amount, paid_at, status')
        .eq('tenant_id', t.tenantId)
        .eq('status', 'succeeded')
        .in('customer_id', lote)
    )

    // 3) Stripe (solo si hace falta ver el motivo): una consulta por cliente, con tope.
    const cfg = await getTenantConfigWithFallback(t.tenantId)
    const auth = cfg.STRIPE_SECRET_KEY
      ? { secretKey: cfg.STRIPE_SECRET_KEY, accountId: cfg.STRIPE_ACCOUNT_ID || null }
      : null
    const fallos = new Map<string, IntentoFallido | null>()

    const estados: Record<string, EstadoImpago> = {}
    for (const c of propias) {
      const cliente = clienteDeContacto.get(contactoDeVenta.get(c.sale_id)!)
      const importe = Number(c.expected_gross_amount || 0)
      const vencimiento = String(c.due_date ?? '')
      const suyos = cliente ? pagos.filter((p) => p.customer_id === cliente) : []
      let fallo: IntentoFallido | null = null
      const yaPagado = clasificarImpago({ vencimiento, importe }, suyos, null).tipo === 'pagado_pendiente_registro'
      if (!yaPagado && cliente && auth) {
        if (!fallos.has(cliente) && fallos.size < 20) fallos.set(cliente, await intentoFallido(cliente, auth))
        fallo = fallos.get(cliente) ?? null
      }
      estados[c.id] = clasificarImpago({ vencimiento, importe }, suyos, fallo)
    }
    return NextResponse.json({ ok: true, estados })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 })
  }
}
