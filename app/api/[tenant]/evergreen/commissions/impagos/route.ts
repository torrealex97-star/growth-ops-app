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

    // El cliente manda las cuotas vencidas que ve (id, venta, vencimiento, importe base). Nada de lo que manda se
    // da por bueno salvo el id de venta, que se vuelve a comprobar contra SU atribución: el resto solo sirve para
    // casar pagos de ESE cliente, así que manipularlo no revela nada ajeno. (Parte de las cuotas llevan un id
    // sintético `venta#n`, por eso no se consulta la tabla de cuotas por id.)
    const body = (await req.json().catch(() => null)) as { cuotas?: unknown } | null
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const pedidas = (Array.isArray(body?.cuotas) ? body.cuotas : [])
      .map((c) => c as { id?: unknown; saleId?: unknown; vencimiento?: unknown; importe?: unknown })
      .filter(
        (c): c is { id: string; saleId: string; vencimiento: string; importe: number } =>
          typeof c.id === 'string' &&
          c.id.length < 80 &&
          typeof c.saleId === 'string' &&
          UUID.test(c.saleId) &&
          typeof c.vencimiento === 'string' &&
          /^\d{4}-\d{2}-\d{2}/.test(c.vencimiento) &&
          typeof c.importe === 'number' &&
          Number.isFinite(c.importe)
      )
      .slice(0, MAX_IDS)
    if (pedidas.length === 0) return NextResponse.json({ ok: true, estados: {} })

    const sb: SupabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const scope = await resolverScopeColaborador(sb, t.userId, t.tenantId)
    if (scope.tipo !== 'collaborator') {
      return NextResponse.json({ error: 'Solo disponible para colaboradores' }, { status: 403 })
    }

    // 1) Ventas → contacto, y de ahí solo las atribuidas a ESTA colaboradora.
    const ventas = await enLotes<{ id: string; contact_id: string | null }>(
      [...new Set(pedidas.map((c) => c.saleId))],
      (lote) => sb.from('sales').select('id, contact_id').in('id', lote).eq('tenant_id', t.tenantId)
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
    const propias = pedidas.filter((c) => {
      const contacto = contactoDeVenta.get(c.saleId)
      return !!contacto && atribuidos.has(contacto)
    })

    // Importe BRUTO real de la cuota cuando existe en BD (el que paga el cliente); el «base comisionable» que manda el
    // cliente puede diferir (IVA, neto). Las cuotas sintéticas (`venta#n`) se quedan con el importe recibido.
    const idsReales = propias.map((c) => c.id).filter((id) => UUID.test(id))
    const brutoDeCuota = new Map(
      (
        await enLotes<{ id: string; sale_id: string; expected_gross_amount: number | string }>(idsReales, (lote) =>
          sb.from('sale_expected_installments').select('id, sale_id, expected_gross_amount').in('id', lote)
        )
      ).map((r) => [`${r.id}|${r.sale_id}`, Number(r.expected_gross_amount || 0)])
    )

    // 2) Cliente de Stripe de cada contacto y sus pagos ya espejados.
    const clientes = await enLotes<{ contact_id: string | null; stripe_customer_id: string }>(
      [...new Set(propias.map((c) => contactoDeVenta.get(c.saleId)!))],
      (lote) =>
        sb
          .from('stripe_customers')
          .select('contact_id, stripe_customer_id')
          .eq('tenant_id', t.tenantId)
          .in('contact_id', lote)
    )
    // Respaldo: contactos sin cliente de Stripe vinculado se casan por el email del pago (pago ya espejado).
    const sinVinculo = contactos.filter((id) => !clientes.some((c) => c.contact_id === id))
    const emailDeContacto = new Map<string, string>()
    if (sinVinculo.length) {
      const filas = await enLotes<{ id: string; email: string | null }>(sinVinculo, (lote) =>
        sb.from('contacts').select('id, email').eq('tenant_id', t.tenantId).in('id', lote)
      )
      for (const f of filas) if (f.email) emailDeContacto.set(f.id, f.email.trim().toLowerCase())
    }
    const pagosPorEmail = emailDeContacto.size
      ? await enLotes<PagoStripeLite & { customer_email: string | null }>(
          [...new Set(emailDeContacto.values())],
          (lote) =>
            sb
              .from('stripe_payments')
              .select('customer_email, amount, paid_at, status')
              .eq('tenant_id', t.tenantId)
              .eq('status', 'succeeded')
              .in('customer_email', lote)
        )
      : []
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
      const cliente = clienteDeContacto.get(contactoDeVenta.get(c.saleId)!)
      const importe = brutoDeCuota.get(`${c.id}|${c.saleId}`) || c.importe
      const vencimiento = c.vencimiento
      const contactoId = contactoDeVenta.get(c.saleId)!
      const email = emailDeContacto.get(contactoId)
      const suyos = cliente
        ? pagos.filter((p) => p.customer_id === cliente)
        : email
          ? pagosPorEmail.filter(
              (p) => (p as { customer_email?: string | null }).customer_email?.toLowerCase() === email
            )
          : []
      let fallo: IntentoFallido | null = null
      const yaPagado = clasificarImpago({ vencimiento, importe }, suyos, null).tipo === 'pagado_pendiente_registro'
      if (!yaPagado && cliente && auth) {
        if (!fallos.has(cliente) && fallos.size < 20) fallos.set(cliente, await intentoFallido(cliente, auth))
        const f = fallos.get(cliente) ?? null
        // Un rechazo anterior al vencimiento de esta cuota es de otro cobro: no se le atribuye.
        fallo = f && f.fecha && f.fecha.slice(0, 10) >= vencimiento.slice(0, 10) ? f : null
      }
      const estado = clasificarImpago({ vencimiento, importe }, suyos, fallo)
      // Sin cliente de Stripe vinculado no se puede afirmar que «no hay intento de cobro»: se dice tal cual.
      estados[c.id] =
        estado.tipo === 'sin_intento' && !cliente
          ? {
              tipo: 'sin_intento',
              texto: 'Aún no consta el pago de este cliente. No podemos ver su estado en Stripe: lo revisa el equipo.',
            }
          : estado
    }
    return NextResponse.json({ ok: true, estados })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 })
  }
}
