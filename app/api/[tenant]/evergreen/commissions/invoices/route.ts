import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import {
  autoSourceFactura,
  autoSourceSueldo,
  construirGastoFactura,
  etiquetaMes,
  importeValido,
  periodoValido,
  rutaFacturaValida,
  CARPETA_FACTURAS,
  type PeriodoFactura,
} from '@/lib/commissions/invoice-expense'

export const runtime = 'nodejs'

// REGISTRAR LA FACTURA DE COMISIONES DE UNA PERSONA Y DEJARLA EN GASTOS.
//
// Quien sube es SIEMPRE la propia persona (nunca se acepta un user_id del cliente) y solo puede registrar
// archivos de SU carpeta de Storage. El colaborador no puede escribir en `expenses` (RLS: solo admin/
// director), así que la fila se crea aquí con la clave de servicio, acotando TODO por tenant_id.
// Ver lib/commissions/invoice-expense.ts para las reglas (P&L, sueldo fijo, idempotencia).

type Gasto = { id: string; status: string }

async function gastoExistente(sb: SupabaseClient, tenantId: string, autoSource: string, ym: string) {
  const { data, error } = await sb
    .from('expenses')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('auto_source', autoSource)
    .eq('period', ym)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el gasto del periodo: ${error.message}`)
  return (data as Gasto | null) ?? null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = await requireTenant(tenant)
    if ('error' in auth) return auth.error

    const body = (await req.json().catch(() => null)) as { period?: unknown; amount?: unknown; path?: unknown } | null
    const periodo: PeriodoFactura | null = periodoValido(body?.period)
    const amount = importeValido(body?.amount)
    const path = body?.path
    if (!periodo) return NextResponse.json({ error: 'Mes de la factura no válido' }, { status: 400 })
    if (amount === null) {
      return NextResponse.json({ error: 'Indica el importe de tu factura (mayor que 0)' }, { status: 400 })
    }
    if (!rutaFacturaValida(path, auth.tenantId, auth.userId)) {
      return NextResponse.json({ error: 'Archivo no válido: sube la factura desde tu panel' }, { status: 400 })
    }

    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    // D9 (docs/MONEY.md): quien no comisiona no factura comisiones.
    const { data: persona } = await sb
      .from('users')
      .select('full_name, pays_commissions')
      .eq('id', auth.userId)
      .maybeSingle()
    if (!persona) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
    if ((persona as { pays_commissions?: boolean | null }).pays_commissions === false) {
      return NextResponse.json({ error: 'Tu perfil no genera comisiones' }, { status: 403 })
    }
    const nombre = String((persona as { full_name?: string | null }).full_name ?? '')

    // El archivo tiene que existir de verdad en la carpeta de esa persona.
    const carpeta = `${auth.tenantId}/${CARPETA_FACTURAS}/${auth.userId}`
    const archivo = path.slice(carpeta.length + 1)
    const { data: listado, error: listErr } = await sb.storage.from('facturas').list(carpeta, {
      search: archivo,
      limit: 10,
    })
    if (listErr || !(listado ?? []).some((f) => f.name === archivo)) {
      return NextResponse.json({ error: 'No se encontró el archivo subido. Inténtalo de nuevo.' }, { status: 400 })
    }

    // Estado actual ANTES de escribir nada: una factura ya pagada no se pisa en silencio.
    const { data: previa } = await sb
      .from('commission_invoices')
      .select('id, status')
      .eq('tenant_id', auth.tenantId)
      .eq('user_id', auth.userId)
      .eq('period_month', periodo.periodMonth)
      .maybeSingle()
    if ((previa as { status?: string } | null)?.status === 'pagada') {
      return NextResponse.json(
        { error: `La factura de ${etiquetaMes(periodo.ym)} ya está pagada y no se puede sustituir` },
        { status: 409 }
      )
    }
    const sueldo = await gastoExistente(sb, auth.tenantId, autoSourceSueldo(auth.userId), periodo.ym)
    const propio = sueldo
      ? null
      : await gastoExistente(sb, auth.tenantId, autoSourceFactura(auth.tenantId, auth.userId), periodo.ym)
    if (propio?.status === 'pagado') {
      return NextResponse.json(
        { error: `El gasto de ${etiquetaMes(periodo.ym)} ya está pagado y no se puede sustituir` },
        { status: 409 }
      )
    }

    const { data: factura, error: invErr } = await sb
      .from('commission_invoices')
      .upsert(
        {
          tenant_id: auth.tenantId,
          user_id: auth.userId,
          period_month: periodo.periodMonth,
          // Se guarda la RUTA del objeto, no una URL pública: la descarga se firma al abrirla.
          invoice_url: path,
          amount,
          status: 'recibida',
        },
        { onConflict: 'user_id,period_month' }
      )
      .select('id')
      .single()
    if (invErr)
      return NextResponse.json({ error: `No se pudo registrar la factura: ${invErr.message}` }, { status: 500 })

    let gasto: 'sueldo' | 'actualizado' | 'creado'
    if (sueldo) {
      // Ya hay un gasto automático de sueldo (fijo + comisión) de esa persona y mes: se adjunta la factura.
      const { error } = await sb
        .from('expenses')
        .update({ invoice_url: path, needs_review: true })
        .eq('id', sueldo.id)
        .eq('tenant_id', auth.tenantId)
      if (error) throw new Error(`No se pudo adjuntar la factura al gasto de sueldo: ${error.message}`)
      gasto = 'sueldo'
    } else {
      const fila = construirGastoFactura({
        tenantId: auth.tenantId,
        userId: auth.userId,
        nombre,
        periodo,
        amount,
        rutaFactura: path,
      })
      const actualizar = async (id: string) => {
        const { error } = await sb
          .from('expenses')
          .update({
            amount: fila.amount,
            concept: fila.concept,
            invoice_url: fila.invoice_url,
            needs_review: true,
          })
          .eq('id', id)
          .eq('tenant_id', auth.tenantId)
        if (error) throw new Error(`No se pudo actualizar el gasto: ${error.message}`)
      }
      if (propio) {
        await actualizar(propio.id)
        gasto = 'actualizado'
      } else {
        const { error } = await sb.from('expenses').insert(fila)
        if (error) {
          // Carrera con otra subida del mismo mes (índice único auto_source+period): se convierte en actualización.
          if (error.code === '23505') {
            const dup = await gastoExistente(sb, auth.tenantId, fila.auto_source, periodo.ym)
            if (!dup) throw new Error(`No se pudo crear el gasto: ${error.message}`)
            await actualizar(dup.id)
            gasto = 'actualizado'
          } else {
            throw new Error(`No se pudo crear el gasto: ${error.message}`)
          }
        } else {
          gasto = 'creado'
        }
      }
    }

    return NextResponse.json({ ok: true, invoiceId: (factura as { id: string }).id, gasto })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 })
  }
}
