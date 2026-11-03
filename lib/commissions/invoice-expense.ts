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
//  · Se analiza con IA igual que en Gastos (lib/ai/invoice-analysis): emisor, NIF, dirección, IBAN/banco del emisor,
//    nº y vencimiento de factura, fecha e importe (siempre EUR). La extracción es una SUGERENCIA: `needs_review`.
//    La categoría se FUERZA a `comisiones` (la IA podría clasificarla como `otros`, que SÍ entra en el opex del P&L y
//    duplicaría el coste de la comisión) y la persona es la que sube, nunca la `suggested_person` de la IA.
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

/** Tamaño máximo de archivo que se manda a analizar (el resto se registra igual, sin IA). */
export const TAMANO_MAX_ANALISIS = 8 * 1024 * 1024

/** Tipo de contenido que entiende el lector de facturas, o null si no se puede analizar (p. ej. HEIC). */
export function mediaTypeDeArchivo(nombre: string): string | null {
  const ext = nombre.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'application/pdf'
  if (ext === 'png') return 'image/png'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  return null
}

/** Lo que devuelve el lector de IA (subconjunto estructural; ver lib/ai/claude.ts InvoiceExtract). */
export type ExtractoFactura = {
  concept?: string | null
  amount?: number | null
  currency?: string | null
  counterparty?: string | null
  invoice_number?: string | null
  invoice_due_date?: string | null
  counterparty_tax_id?: string | null
  counterparty_address?: string | null
  counterparty_bank_account?: string | null
  counterparty_bank_name?: string | null
  expense_date?: string | null
  original_amount?: number
  original_currency?: string
  fx_rate?: number
}

const texto = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

/** Fecha YYYY-MM-DD real (no 2026-02-31) o null. */
export function fechaIso(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const d = new Date(`${v}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v
}

const eur = (n: number) => `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/** Nota que deja constancia de una conversión de moneda automática (misma redacción que en Gastos). */
export function notaConversion(e: ExtractoFactura | null | undefined): string | null {
  if (!e || !e.original_currency || typeof e.original_amount !== 'number' || typeof e.amount !== 'number') return null
  const original = e.original_amount.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const tasa =
    e.fx_rate == null ? '?' : e.fx_rate.toLocaleString('es-ES', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  return `Factura original en ${e.original_currency} ${original} · convertido a ${eur(e.amount)} (tasa ${tasa})`
}

/**
 * Importe del gasto: lo que dice la factura (IA, ya en EUR) manda; si la IA no lo leyó, el que declara la persona.
 * Si hay ambos y difieren de verdad se devuelve una nota para que finanzas lo contraste.
 */
export function resolverImporte(
  extraido: ExtractoFactura | null | undefined,
  declarado: number | null
): { amount: number; origen: 'factura' | 'declarado'; nota: string | null } | null {
  const leido = importeValido(extraido?.amount)
  if (leido !== null) {
    const difiere = declarado !== null && Math.abs(declarado - leido) > Math.max(0.01, leido * 0.01)
    return {
      amount: leido,
      origen: 'factura',
      nota: difiere ? `Importe declarado por la persona: ${eur(declarado!)}; la factura dice ${eur(leido)}.` : null,
    }
  }
  if (declarado !== null) return { amount: declarado, origen: 'declarado', nota: null }
  return null
}

/** Campos de identidad/trazabilidad de la factura que se vuelcan a un gasto ya existente (solo los que hay). */
export function camposDeFactura(extraido: ExtractoFactura | null | undefined) {
  if (!extraido) return {}
  const campos: Record<string, unknown> = { ai_extracted: extraido }
  const pares: [string, string | null][] = [
    ['invoice_number', texto(extraido.invoice_number)],
    ['invoice_due_date', fechaIso(extraido.invoice_due_date)],
    ['counterparty_tax_id', texto(extraido.counterparty_tax_id)],
    ['counterparty_address', texto(extraido.counterparty_address)],
    ['counterparty_bank_account', texto(extraido.counterparty_bank_account)],
    ['counterparty_bank_name', texto(extraido.counterparty_bank_name)],
  ]
  for (const [k, v] of pares) if (v !== null) campos[k] = v
  return campos
}

/** Fila de `expenses` para una factura de comisiones de colaborador que NO tiene gasto de sueldo en ese mes. */
export function construirGastoFactura(args: {
  tenantId: string
  userId: string
  nombre: string
  periodo: PeriodoFactura
  amount: number
  rutaFactura: string
  /** Lo que extrajo la IA de la factura (opcional: sin IA se crea con los datos mínimos). */
  extraido?: ExtractoFactura | null
  /** Notas adicionales (p. ej. importe declarado ≠ factura). */
  notasExtra?: (string | null)[]
}) {
  const { tenantId, userId, nombre, periodo, amount, rutaFactura, extraido } = args
  const quien = nombre.trim() || 'Colaborador'
  const emisor = texto(extraido?.counterparty) ?? quien
  const notas = [
    notaConversion(extraido),
    ...(args.notasExtra ?? []),
    extraido
      ? 'Subida por la propia persona y leída con IA: revisar los datos extraídos antes de pagar.'
      : 'Subida por la propia persona desde su panel. Sin lectura de IA: contrastar el importe con sus comisiones.',
  ].filter((n): n is string => !!n)
  return {
    tenant_id: tenantId,
    concept: texto(extraido?.concept) ?? `Factura de comisiones · ${quien} · ${etiquetaMes(periodo.ym)}`,
    // FORZADA: la IA podría decir `otros`, que sí entra en el opex del P&L y duplicaría la comisión.
    category: 'comisiones' as const,
    subcategory: emisor,
    amount,
    expense_date: fechaIso(extraido?.expense_date) ?? periodo.periodMonth,
    recurring: false,
    frequency: null,
    payment_method: 'transferencia',
    // Pendiente de pago; `needs_review` porque el importe y los datos bancarios los lee una IA / los declara la
    // propia persona y finanzas debe contrastarlos antes de pagar.
    status: 'pendiente' as const,
    counterparty: emisor,
    person_id: userId,
    notes: notas.join(' · '),
    created_by: userId,
    invoice_url: rutaFactura,
    needs_review: true,
    auto_source: autoSourceFactura(tenantId, userId),
    period: periodo.ym,
    ...camposDeFactura(extraido),
    // Sin extracción las columnas de identidad quedan null (no se rellenan con basura).
    ai_extracted: extraido ?? null,
  }
}
