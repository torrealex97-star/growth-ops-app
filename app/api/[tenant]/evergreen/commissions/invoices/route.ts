import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { analizarFactura, type FacturaAnalizada } from '@/lib/ai/invoice-analysis'
import { requireTenant } from '@/lib/auth/requireTenant'
import {
  autoSourceFactura,
  autoSourceSueldo,
  camposDeFactura,
  construirGastoFactura,
  etiquetaMes,
  importeValido,
  mediaTypeDeArchivo,
  periodoValido,
  resolverImporte,
  rutaFacturaValida,
  CARPETA_FACTURAS,
  TAMANO_MAX_ANALISIS,
  type PeriodoFactura,
} from '@/lib/commissions/invoice-expense'

export const runtime = 'nodejs'
// Incluye la lectura de la factura con IA (hasta ~60 s en el peor caso, como la ruta de Gastos).
export const maxDuration = 60

// REGISTRAR LA FACTURA DE COMISIONES DE UNA PERSONA, LEERLA CON IA Y DEJARLA EN GASTOS.
//
// Quien sube es SIEMPRE la propia persona (nunca se acepta un user_id del cliente) y solo puede registrar
// archivos de SU carpeta de Storage. El colaborador no puede escribir en `expenses` (RLS: solo admin/
// director), así que la fila se crea aquí con la clave de servicio, acotando TODO por tenant_id.
// El análisis con IA es el mismo que usa Gastos (lib/ai/invoice-analysis). Ver lib/commissions/invoice-expense.ts
// para las reglas (P&L, sueldo fijo, idempotencia, categoría forzada).

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

/** Descarga el archivo ya subido y lo lee con la IA. Un fallo NO bloquea el registro: devuelve null y el motivo. */
async function leerConIa(
  sb: SupabaseClient,
  tenantId: string,
  path: string,
  archivo: string
): Promise<{ extraido: FacturaAnalizada | null; motivo: string | null }> {
  const mediaType = mediaTypeDeArchivo(archivo)
  if (!mediaType) return { extraido: null, motivo: 'Formato no analizable (usa PDF, PNG, JPG o WEBP)' }
  try {
    const { data: blob, error } = await sb.storage.from('facturas').download(path)
    if (error || !blob) return { extraido: null, motivo: 'No se pudo leer el archivo para analizarlo' }
    if (blob.size > TAMANO_MAX_ANALISIS) return { extraido: null, motivo: 'Archivo demasiado grande para analizarlo' }
    const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64')
    return { extraido: await analizarFactura(sb, tenantId, base64, mediaType), motivo: null }
  } catch (e) {
    return { extraido: null, motivo: e instanceof Error ? e.message : 'No se pudo analizar la factura' }
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const auth = await requireTenant(tenant)
    if ('error' in auth) return auth.error

    const body = (await req.json().catch(() => null)) as { period?: unknown; amount?: unknown; path?: unknown } | null
    const periodo: PeriodoFactura | null = periodoValido(body?.period)
    const path = body?.path
    // El importe es OPCIONAL: lo normal es que lo lea la IA de la factura; si lo declara, se contrasta.
    const hayDeclarado = body?.amount !== undefined && body?.amount !== null && body?.amount !== ''
    const declarado = hayDeclarado ? importeValido(body?.amount) : null
    if (!periodo) return NextResponse.json({ error: 'Mes de la factura no válido' }, { status: 400 })
    if (hayDeclarado && declarado === null) {
      return NextResponse.json({ error: 'El importe no es válido (debe ser mayor que 0)' }, { status: 400 })
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

    // Estado actual ANTES de escribir nada (y antes de gastar una llamada a la IA): lo ya pagado no se pisa.
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

    // LECTURA CON IA (igual que en Gastos). Si falla, se sigue con el importe declarado.
    const { extraido, motivo: motivoIa } = await leerConIa(sb, auth.tenantId, path, archivo)
    const importe = resolverImporte(extraido, declarado)
    if (!importe) {
      return NextResponse.json(
        {
          error: motivoIa
            ? `No pudimos leer el importe de la factura (${motivoIa}). Indícalo a mano e inténtalo de nuevo.`
            : 'No pudimos leer el importe de la factura. Indícalo a mano e inténtalo de nuevo.',
        },
        { status: 422 }
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
          amount: importe.amount,
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
      // Ya hay un gasto automático de sueldo (fijo + comisión) de esa persona y mes: se adjunta la factura y los
      // datos leídos de ella; el importe y el estado del gasto NO se tocan.
      const { error } = await sb
        .from('expenses')
        .update({ invoice_url: path, needs_review: true, ...camposDeFactura(extraido) })
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
        amount: importe.amount,
        rutaFactura: path,
        extraido,
        notasExtra: [importe.nota, extraido ? null : motivoIa ? `Sin lectura de IA: ${motivoIa}.` : null],
      })
      const actualizar = async (id: string) => {
        const { error } = await sb
          .from('expenses')
          .update({
            amount: fila.amount,
            concept: fila.concept,
            subcategory: fila.subcategory,
            counterparty: fila.counterparty,
            expense_date: fila.expense_date,
            invoice_url: fila.invoice_url,
            notes: fila.notes,
            needs_review: true,
            ...camposDeFactura(extraido),
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

    return NextResponse.json({
      ok: true,
      invoiceId: (factura as { id: string }).id,
      gasto,
      importe: importe.amount,
      analizadaConIa: !!extraido,
      avisoIa: extraido ? null : motivoIa,
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error interno' }, { status: 500 })
  }
}
