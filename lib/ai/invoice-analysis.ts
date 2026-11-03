import type { SupabaseClient } from '@supabase/supabase-js'
import { extractInvoice, type InvoiceExtract } from '@/lib/ai/claude'
import { tenantAiEnv } from '@/lib/ai/provider'
import { tenantActiveUserNames } from '@/lib/users'

// ANÁLISIS DE FACTURAS CON IA — UNA sola implementación para todos los que suben una factura:
//   · la pantalla de Gastos (ruta ai/invoice: admin/director/manager),
//   · la factura de comisiones del colaborador (ruta commissions/invoices).
// Así lo que se extrae, cómo se convierte a EUR y con qué clave de IA se factura es idéntico.

export type FacturaAnalizada = InvoiceExtract & {
  original_amount?: number
  original_currency?: string
  fx_rate?: number
}

// Convierte un importe a EUR usando tipos de cambio del BCE (vía frankfurter.dev, sin clave).
// Si la moneda ya es EUR o la conversión falla, devuelve null y el importe se deja tal cual.
export async function convertToEur(
  amount: number,
  currency: string,
  date: string | null
): Promise<{ amountEur: number; rate: number } | null> {
  const code = currency.trim().toUpperCase()
  if (code === 'EUR') return null
  try {
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : 'latest'
    const res = await fetch(`https://api.frankfurter.dev/v1/${day}?base=${code}&symbols=EUR`, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const rate = data?.rates?.EUR
    if (typeof rate !== 'number' || !isFinite(rate)) return null
    return { amountEur: Math.round(amount * rate * 100) / 100, rate }
  } catch {
    return null
  }
}

/**
 * Lee la factura (base64 + tipo) con la IA de la subcuenta y devuelve los datos extraídos con el importe SIEMPRE
 * en EUR (si venía en otra moneda se convierte y se guarda el original). La extracción es una SUGERENCIA: quien la
 * use debe dejar el gasto en `needs_review`.
 */
export async function analizarFactura(
  sb: SupabaseClient,
  tenantId: string,
  base64: string,
  mediaType: string
): Promise<FacturaAnalizada> {
  // Solo el equipo de ESTA subcuenta: antes se mandaban al modelo los nombres de todos los usuarios activos de la
  // plataforma, los de otras subcuentas incluidos.
  const teamNames = await tenantActiveUserNames(sb, tenantId)
  const limpio = base64.includes(',') ? base64.split(',')[1] : base64
  // Con la config de IA de la subcuenta: la factura se lee con SU clave de Anthropic.
  const extracted = await extractInvoice(limpio, mediaType, teamNames, await tenantAiEnv(tenantId))

  // El resto de la app (importes, totales, informes) asume EUR. Si la factura viene en otra moneda, convertimos
  // aquí para que "amount" siempre sea EUR, y guardamos el original para que quede constancia de la conversión.
  if (typeof extracted.amount === 'number' && extracted.currency && extracted.currency.toUpperCase() !== 'EUR') {
    const converted = await convertToEur(extracted.amount, extracted.currency, extracted.expense_date)
    if (converted) {
      return {
        ...extracted,
        original_amount: extracted.amount,
        original_currency: extracted.currency.toUpperCase(),
        fx_rate: converted.rate,
        amount: converted.amountEur,
        currency: 'EUR',
      }
    }
  }
  return extracted
}
