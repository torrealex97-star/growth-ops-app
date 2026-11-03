// FACTURA DEL COLABORADOR → GASTO. Lógica PURA (sin Supabase ni Next) para poder congelarla con tests.
//
// Un colaborador sube su factura de comisiones desde su panel. Para que aparezca en Gastos hace falta una
// fila en `expenses`, y un colaborador NO puede escribir ahí (RLS: solo admin/director): la crea la ruta
// de servidor `commissions/invoices`, que valida con estas funciones y firma la fila con `created_by`.
//
// Reglas (docs/MONEY.md):
//  · La comisión ya cuenta en el P&L desde el libro de comisiones (`pnl.comisiones`); un gasto de categoría
//    `comisiones` NO se suma al P&L (solo sueldos/publicidad/herramientas/eventos/otros/cogs): es el
//    registro de la factura y del pago, no un coste nuevo.
//  · Quien ya tiene sueldo fijo tiene un gasto automático `salary:<usuario>` (fijo + comisión) en el cron
//    mensual: ahí se ADJUNTA la factura, no se crea otro gasto (sería contar dos veces el mismo pago).
//  · Idempotente por (auto_source, period): re-subir la factura del mes actualiza, no duplica. El índice
//    único de `expenses` es global, así que `auto_source` lleva la subcuenta y la persona.

export const AUTO_SOURCE_FACTURA = 'commission_invoice'
export const CARPETA_FACTURAS = 'comisiones'

/** Importe máximo aceptable en una factura de comisiones de una persona (cinturón contra errores de tecleo). */
export const IMPORTE_MAXIMO = 1_000_000

export type PeriodoFactura = {
  /** YYYY-MM-01 (columna `commission_invoices.period_month`, de tipo date). */
  periodMonth: string
  /** YYYY-MM (columna `expenses.period`). */
  ym: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Acepta `YYYY-MM` o `YYYY-MM-DD` (se normaliza al día 1). Rechaza meses fuera de ventana: no más de 24 meses
 * atrás ni posteriores al mes siguiente al actual (se factura lo ya cerrado, no el futuro lejano).
 */
export function periodoValido(valor: unknown, ahora = new Date()): PeriodoFactura | null {
  if (typeof valor !== 'string') return null
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(valor.trim())
  if (!m) return null
  const y = Number(m[1])
  const mes = Number(m[2])
  if (mes < 1 || mes > 12) return null
  const indice = y * 12 + (mes - 1)
  const actual = ahora.getFullYear() * 12 + ahora.getMonth()
  if (indice > actual + 1 || indice < actual - 24) return null
  return { periodMonth: `${y}-${pad(mes)}-01`, ym: `${y}-${pad(mes)}` }
}

/** Importe en euros con 2 decimales, o null si no es un número positivo razonable. */
export function importeValido(valor: unknown): number | null {
  const n = typeof valor === 'number' ? valor : typeof valor === 'string' ? Number(valor.replace(',', '.')) : NaN
  if (!Number.isFinite(n) || n <= 0 || n > IMPORTE_MAXIMO) return null
  return Math.round(n * 100) / 100
}

/**
 * La ruta del archivo en Storage debe colgar de SU carpeta (`<subcuenta>/comisiones/<persona>/`): es lo que
 * impide registrar como propia la factura de otra persona o de otra subcuenta, aunque el cliente mande
 * cualquier ruta.
 */
export function rutaFacturaValida(ruta: unknown, tenantId: string, userId: string): ruta is string {
  if (typeof ruta !== 'string' || ruta.length === 0 || ruta.length > 300) return false
  const prefijo = `${tenantId}/${CARPETA_FACTURAS}/${userId}/`
  if (!ruta.startsWith(prefijo)) return false
  const resto = ruta.slice(prefijo.length)
  return resto.length > 0 && !resto.includes('/') && !resto.includes('..') && !/[\\\0]/.test(resto)
}

export function autoSourceFactura(tenantId: string, userId: string): string {
  return `${AUTO_SOURCE_FACTURA}:${tenantId}:${userId}`
}

export const autoSourceSueldo = (userId: string) => `salary:${userId}`

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

export function etiquetaMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MESES[(m ?? 1) - 1] ?? ym} ${y}`
}

/** Fila de `expenses` para una factura de comisiones de colaborador que NO tiene gasto de sueldo en ese mes. */
export function construirGastoFactura(args: {
  tenantId: string
  userId: string
  nombre: string
  periodo: PeriodoFactura
  amount: number
  rutaFactura: string
}) {
  const { tenantId, userId, nombre, periodo, amount, rutaFactura } = args
  const quien = nombre.trim() || 'Colaborador'
  return {
    tenant_id: tenantId,
    concept: `Factura de comisiones · ${quien} · ${etiquetaMes(periodo.ym)}`,
    category: 'comisiones' as const,
    subcategory: quien,
    amount,
    expense_date: periodo.periodMonth,
    recurring: false,
    frequency: null,
    payment_method: 'transferencia',
    // Pendiente de pago; `needs_review` porque el importe lo declara la propia persona y finanzas debe
    // contrastarlo con lo liquidado antes de pagar.
    status: 'pendiente' as const,
    counterparty: quien,
    person_id: userId,
    notes: 'Subida por la propia persona desde su panel. Importe declarado por ella: contrastar con sus comisiones.',
    created_by: userId,
    invoice_url: rutaFactura,
    needs_review: true,
    ai_extracted: null,
    auto_source: autoSourceFactura(tenantId, userId),
    period: periodo.ym,
  }
}
