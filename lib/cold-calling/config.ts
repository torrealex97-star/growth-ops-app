import type { SupabaseClient } from '@supabase/supabase-js'
import { ErrorColdCalling } from './policy'

// AJUSTES DE COLD CALLING POR SUBCUENTA (tabla `cold_calling_settings`).
//
// En el origen los tramos de comisión, el tamaño de la tanda y el objetivo eran constantes en el
// código: valían para una sola empresa. Aquí son dato de cada subcuenta y NO hay importes por
// defecto: sin tramos configurados, la comisión no se calcula y las pantallas lo dicen. Los únicos
// valores por defecto son operativos (cuántos leads por tanda), no de dinero.

export type Tramo = {
  /** Número de venta (1 = la primera de esa persona en el lanzamiento) desde el que aplica. */
  desde: number
  /** Última venta a la que aplica, o null = en adelante. */
  hasta: number | null
  /** Importe fijo por venta, en la moneda de la subcuenta. */
  importe: number
}

export type AjustesColdCalling = {
  tramos: Tramo[]
  /** Leads que se entregan en cada «Dame más». */
  tanda: number
  /** Se puede pedir más cuando quedan estos o menos sin llamar. */
  pedirMasSiQuedan: number
  /** Objetivo de confirmados por persona y lanzamiento, o null si no se usa. */
  objetivoConfirmados: number | null
  /** false = nadie ha guardado ajustes en esta subcuenta todavía. */
  guardado: boolean
}

export const AJUSTES_INICIALES: AjustesColdCalling = {
  tramos: [],
  tanda: 20,
  pedirMasSiQuedan: 10,
  objetivoConfirmados: null,
  guardado: false,
}

const MAX_TRAMOS = 10
const entero = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null)

/**
 * Valida y normaliza los tramos. Tienen que cubrir todas las ventas sin huecos ni solapes: el
 * primero empieza en 1, cada uno empieza donde acaba el anterior y el último no tiene tope.
 * Una lista vacía es válida y significa "no hay comisión por venta".
 */
export function validarTramos(input: unknown): Tramo[] {
  if (!Array.isArray(input)) throw new ErrorColdCalling('Los tramos tienen que ser una lista')
  if (input.length > MAX_TRAMOS) throw new ErrorColdCalling(`Como mucho ${MAX_TRAMOS} tramos`)
  const tramos: Tramo[] = input.map((crudo, i) => {
    const t = (crudo ?? {}) as Record<string, unknown>
    const desde = entero(t.desde)
    const hasta = t.hasta === null || t.hasta === undefined ? null : entero(t.hasta)
    const importe = typeof t.importe === 'number' && Number.isFinite(t.importe) ? t.importe : null
    if (desde === null || desde < 1)
      throw new ErrorColdCalling(`Tramo ${i + 1}: «desde» tiene que ser un número entero`)
    if (t.hasta !== null && t.hasta !== undefined && hasta === null) {
      throw new ErrorColdCalling(`Tramo ${i + 1}: «hasta» tiene que ser un número entero o quedar vacío`)
    }
    if (importe === null || importe < 0 || importe > 1_000_000) {
      throw new ErrorColdCalling(`Tramo ${i + 1}: el importe no es válido`)
    }
    if (Math.abs(importe * 100 - Math.round(importe * 100)) > 1e-6) {
      throw new ErrorColdCalling(`Tramo ${i + 1}: el importe admite como mucho dos decimales`)
    }
    return { desde, hasta, importe: Math.round(importe * 100) / 100 }
  })
  let esperado = 1
  tramos.forEach((t, i) => {
    const ultimo = i === tramos.length - 1
    if (t.desde !== esperado) {
      throw new ErrorColdCalling(
        `Tramo ${i + 1}: tiene que empezar en la venta ${esperado} para no dejar huecos ni solaparse`
      )
    }
    if (ultimo) {
      if (t.hasta !== null) throw new ErrorColdCalling('El último tramo no lleva tope: aplica «en adelante»')
    } else {
      if (t.hasta === null || t.hasta < t.desde) {
        throw new ErrorColdCalling(`Tramo ${i + 1}: «hasta» tiene que ser igual o mayor que «desde»`)
      }
      esperado = t.hasta + 1
    }
  })
  return tramos
}

/** Importe de la venta nº `n` (1 = primera). null = no hay tramos: no se calcula comisión. */
export function importeDeVenta(tramos: Tramo[], n: number): number | null {
  if (tramos.length === 0 || n < 1) return null
  const t = tramos.find((x) => n >= x.desde && (x.hasta === null || n <= x.hasta))
  return t ? t.importe : null
}

type Fila = {
  tramos: unknown
  tanda: number
  pedir_mas_si_quedan: number
  objetivo_confirmados: number | null
}

/** Tablas de cold calling aún sin crear (migración 20261110110000 sin aplicar). */
export const esTablaInexistente = (error: { code?: string; message?: string } | null | undefined): boolean =>
  error?.code === '42P01' ||
  error?.code === 'PGRST205' ||
  /cold_calling_\w+.*(does not exist|schema cache)/i.test(error?.message ?? '')

export const FALTA_MIGRACION =
  'El módulo de cold calling necesita la migración 20261110110000_cold_calling.sql, que aún no está aplicada en esta base de datos'

export async function leerAjustes(sb: SupabaseClient, tenantId: string): Promise<AjustesColdCalling> {
  const { data, error } = await sb
    .from('cold_calling_settings')
    .select('tramos, tanda, pedir_mas_si_quedan, objetivo_confirmados')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) {
    if (esTablaInexistente(error)) throw new ErrorColdCalling(FALTA_MIGRACION, 409)
    throw new Error(`No se pudieron leer los ajustes de cold calling: ${error.message}`)
  }
  if (!data) return AJUSTES_INICIALES
  const f = data as Fila
  let tramos: Tramo[] = []
  try {
    tramos = validarTramos(f.tramos)
  } catch {
    // Unos tramos guardados que ya no validan no pueden generar importes: se tratan como ausentes.
    tramos = []
  }
  return {
    tramos,
    tanda: f.tanda,
    pedirMasSiQuedan: f.pedir_mas_si_quedan,
    objetivoConfirmados: f.objetivo_confirmados,
    guardado: true,
  }
}

const enRango = (v: unknown, min: number, max: number, nombre: string): number => {
  const n = entero(v)
  if (n === null || n < min || n > max) throw new ErrorColdCalling(`${nombre}: tiene que estar entre ${min} y ${max}`)
  return n
}

export async function guardarAjustes(
  sb: SupabaseClient,
  tenantId: string,
  userId: string,
  input: { tramos?: unknown; tanda?: unknown; pedirMasSiQuedan?: unknown; objetivoConfirmados?: unknown }
): Promise<AjustesColdCalling> {
  const fila = {
    tenant_id: tenantId,
    tramos: validarTramos(input.tramos ?? []),
    tanda: enRango(input.tanda, 1, 200, 'Leads por tanda'),
    pedir_mas_si_quedan: enRango(input.pedirMasSiQuedan, 0, 200, 'Umbral para pedir más'),
    objetivo_confirmados:
      input.objetivoConfirmados === null || input.objetivoConfirmados === undefined || input.objetivoConfirmados === ''
        ? null
        : enRango(input.objetivoConfirmados, 1, 100000, 'Objetivo de confirmados'),
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }
  const { error } = await sb.from('cold_calling_settings').upsert(fila, { onConflict: 'tenant_id' })
  if (error) {
    if (esTablaInexistente(error)) throw new ErrorColdCalling(FALTA_MIGRACION, 409)
    throw new Error(`No se pudieron guardar los ajustes: ${error.message}`)
  }
  return leerAjustes(sb, tenantId)
}
