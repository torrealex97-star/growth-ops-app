// MESES DEL COLABORADOR — helpers puros (sin React ni Supabase) para el selector único de mes.
//
// Vocabulario (lo que el colaborador entiende):
//   · MES VENCIDO = el mes que acaba de cerrar. Es el que se factura y el que está POR COBRAR: lo que sus clientes
//     pagaron en ese mes se le paga el mes siguiente (el motor liquida el mes siguiente al cobro:
//     calculator.getLiquidationMonth). Es el valor POR DEFECTO.
//   · MES ACTUAL = el que está en curso: lo que se va generando ahora y se pagará el mes que viene.
// Una clave de mes es siempre `YYYY-MM`.

export const MESES_ES = [
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

const pad = (n: number) => String(n).padStart(2, '0')

export function claveDeMes(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function esClaveDeMes(v: unknown): v is string {
  if (typeof v !== 'string') return false
  const m = /^(\d{4})-(\d{2})$/.exec(v)
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12
}

/** Suma (o resta) meses a una clave `YYYY-MM`. */
export function sumarMeses(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const indice = y * 12 + (m - 1) + n
  return `${Math.floor(indice / 12)}-${pad((indice % 12) + 1)}`
}

export const mesActual = (ahora = new Date()) => claveDeMes(ahora)

/** El mes que acaba de cerrar: el que se factura y está por cobrar. Valor por defecto del selector. */
export const mesVencido = (ahora = new Date()) => sumarMeses(claveDeMes(ahora), -1)

/** Mes en el que se PAGA lo generado en `ym`: el siguiente. */
export const mesDePagoDe = (ym: string) => sumarMeses(ym, 1)

/** Meses elegibles, del actual hacia atrás (`atras` meses antes del actual). */
export function mesesDisponibles(ahora = new Date(), atras = 12): string[] {
  const actual = mesActual(ahora)
  return Array.from({ length: atras + 1 }, (_, i) => sumarMeses(actual, -i))
}

/** Primer y último día del mes (YYYY-MM-DD), para filtrar por rango. */
export function limitesDeMes(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  return { from: `${ym}-01`, to: `${ym}-${pad(ultimo)}` }
}

/** «Octubre 2026». Solo la inicial en mayúscula (el `capitalize` de CSS pondría también «De»). */
export function etiquetaMesLarga(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  const mes = MESES_ES[(m ?? 1) - 1] ?? ym
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${y}`
}

/** «octubre» / «noviembre»: para frases como «se paga en noviembre». */
export function nombreDeMes(ym: string): string {
  const [, m] = ym.split('-').map(Number)
  return MESES_ES[(m ?? 1) - 1] ?? ym
}

/** Marca de un mes frente a hoy: vencido, actual, futuro o anterior. */
export function etapaDeMes(ym: string, ahora = new Date()): 'vencido' | 'actual' | 'futuro' | 'anterior' {
  const actual = mesActual(ahora)
  if (ym === actual) return 'actual'
  if (ym === mesVencido(ahora)) return 'vencido'
  return ym > actual ? 'futuro' : 'anterior'
}
