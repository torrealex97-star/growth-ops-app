// LÓGICA PURA DEL PANEL DEL COLABORADOR (sin React ni Supabase), para poder congelarla con tests.
//   · historial mes a mes con su factura, total generado y previsión (aparte);
//   · embudo DESDE LAS AGENDAS (no desde los leads) de un mes;
//   · clasificación de una cuota vencida según lo que dice Stripe.
import { isAttended, isCancelled, isNoShow } from '@/lib/appointments/status'
import { sumarMeses } from '@/lib/commissions/meses'
import type { MesComision } from '@/lib/commissions/mensual'

// ── Historial, total y previsión ─────────────────────────────────────────────────────────────

export type FacturaMes = {
  id: string
  period_month: string
  invoice_url: string | null
  amount: number | null
  status: string
}

export type FilaHistorial = {
  month: string
  /** Lo ya generado (sin la previsión: esa depende de que el cliente pague). */
  generado: number
  nuevo: number
  recurrente: number
  pagado: number
  porCobrar: number
  factura: FacturaMes | null
}

const centimos = (n: number) => Math.round(n * 100) / 100

/**
 * Registro de todo lo generado, del mes ACTUAL hacia atrás hasta el primero con actividad. La previsión NO entra
 * (va aparte, `previsionFutura`). Un mes sin nada generado y sin factura no ocupa una fila.
 */
export function historialMensual(meses: MesComision[], facturas: FacturaMes[], ahora = new Date()): FilaHistorial[] {
  const actual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`
  const factura = new Map(facturas.map((f) => [f.period_month.slice(0, 7), f]))
  return meses
    .filter((m) => m.month <= actual)
    .map((m) => {
      const generado = centimos(m.total - m.prevista)
      const pagado = centimos(m.pagado)
      return {
        month: m.month,
        generado,
        nuevo: centimos(m.nuevo.amount - m.nuevo.prevista),
        recurrente: centimos(m.recurrente.amount - m.recurrente.prevista),
        pagado,
        porCobrar: centimos(generado - pagado),
        factura: factura.get(m.month) ?? null,
      }
    })
    .filter((f) => f.generado !== 0 || f.factura)
    .sort((a, b) => b.month.localeCompare(a.month))
}

/** Total generado desde que empezó (todo lo ya generado, sin previsión) y cuánto está pagado / por cobrar. */
export function totalGenerado(filas: FilaHistorial[]) {
  const generado = centimos(filas.reduce((s, f) => s + f.generado, 0))
  const pagado = centimos(filas.reduce((s, f) => s + f.pagado, 0))
  return { generado, pagado, porCobrar: centimos(generado - pagado) }
}

export type FilaPrevision = { month: string; importe: number; nuevo: number; recurrente: number }

/**
 * PREVISIÓN (aparte de lo generado): lo que se facturará en los próximos meses si los clientes siguen pagando.
 * Incluye lo que falta por cobrar de ESTE mes y los meses siguientes. Solo meses con importe.
 */
export function previsionFutura(meses: MesComision[], ahora = new Date()): FilaPrevision[] {
  const actual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`
  return meses
    .filter((m) => m.month >= actual && m.prevista > 0)
    .map((m) => ({
      month: m.month,
      importe: centimos(m.prevista),
      nuevo: centimos(m.nuevo.prevista),
      recurrente: centimos(m.recurrente.prevista),
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

/** Últimos `n` meses (hasta el actual) con ceros donde no hay nada, para que el gráfico no tenga huecos. */
export function serieMensual(meses: MesComision[], ahora = new Date(), n = 12) {
  const actual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`
  const porMes = new Map(meses.map((m) => [m.month, m]))
  return Array.from({ length: n }, (_, i) => sumarMeses(actual, i - (n - 1))).map((month) => {
    const m = porMes.get(month)
    return {
      month,
      nuevo: m ? centimos(m.nuevo.amount - m.nuevo.prevista) : 0,
      recurrente: m ? centimos(m.recurrente.amount - m.recurrente.prevista) : 0,
    }
  })
}

// ── Embudo desde las AGENDAS ─────────────────────────────────────────────────────────────────

export type CitaPanel = {
  id: string
  contact_id: string | null
  appointment_datetime: string | null
  status: string | null
}
export type VentaPanel = {
  id: string
  contact_id: string | null
  gross_amount: number | string | null
  status: string | null
  created_at: string | null
}

export type EmbudoMes = {
  agendas: number
  asistieron: number
  noAsistieron: number
  canceladas: number
  /** Aún por celebrar (o sin resultado registrado). */
  pendientes: number
  ventas: number
  importe: number
  pctAsistencia: number
  pctVenta: number
}

const enMes = (fecha: string | null | undefined, ym: string) => !!fecha && String(fecha).slice(0, 7) === ym
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0)

/**
 * Embudo de un mes que EMPIEZA en las agendas (no en los leads: los contactos sin agenda no cuentan): agendas →
 * asistieron → ventas. `esVentaActiva` viene de lib/analytics (isActiveSale) para no redefinirlo aquí.
 */
export function embudoDelMes(
  citas: CitaPanel[],
  ventas: VentaPanel[],
  ym: string,
  esVentaActiva: (v: VentaPanel) => boolean
): EmbudoMes {
  const delMes = citas.filter((c) => enMes(c.appointment_datetime, ym))
  const asistieron = delMes.filter((c) => isAttended(c.status)).length
  const noAsistieron = delMes.filter((c) => isNoShow(c.status)).length
  const canceladas = delMes.filter((c) => isCancelled(c.status)).length
  const ventasMes = ventas.filter((v) => esVentaActiva(v) && enMes(v.created_at, ym))
  return {
    agendas: delMes.length,
    asistieron,
    noAsistieron,
    canceladas,
    pendientes: Math.max(delMes.length - asistieron - noAsistieron - canceladas, 0),
    ventas: ventasMes.length,
    importe: centimos(ventasMes.reduce((s, v) => s + Number(v.gross_amount ?? 0), 0)),
    pctAsistencia: pct(asistieron, delMes.length),
    pctVenta: pct(ventasMes.length, asistieron),
  }
}

// ── Estado de una cuota vencida según Stripe ─────────────────────────────────────────────────

export type PagoStripeLite = { amount: number; paid_at: string | null; status: string }
export type IntentoFallido = {
  code?: string | null
  declineCode?: string | null
  message?: string | null
  fecha?: string | null
}

export type EstadoImpago =
  | { tipo: 'pagado_pendiente_registro'; fecha: string | null; texto: string }
  | { tipo: 'pago_rechazado'; fecha: string | null; motivo: string; texto: string }
  | { tipo: 'sin_intento'; texto: string }

const MOTIVOS: Record<string, string> = {
  insufficient_funds: 'Fondos insuficientes en la tarjeta',
  card_declined: 'La tarjeta fue rechazada por el banco',
  generic_decline: 'El banco rechazó el cobro',
  expired_card: 'La tarjeta ha caducado',
  incorrect_cvc: 'CVC incorrecto',
  incorrect_number: 'Número de tarjeta incorrecto',
  lost_card: 'Tarjeta bloqueada por pérdida',
  stolen_card: 'Tarjeta bloqueada',
  do_not_honor: 'El banco no autorizó el cobro',
  authentication_required: 'El banco pide verificar la compra (3D Secure)',
  card_velocity_exceeded: 'Límite de operaciones de la tarjeta superado',
  processing_error: 'Error de procesamiento del banco',
  pickup_card: 'Tarjeta retenida por el banco',
  fraudulent: 'Cobro bloqueado por sospecha de fraude',
}

export function motivoDeRechazo(f: IntentoFallido): string {
  return (
    (f.declineCode && MOTIVOS[f.declineCode]) ||
    (f.code && MOTIVOS[f.code]) ||
    (f.message ? f.message : 'Motivo no informado por el banco')
  )
}

/**
 * ¿Qué le pasa de verdad a una cuota VENCIDA? Tres casos, del más a menos tranquilizador:
 *  1. Stripe ya la cobró (un pago correcto del cliente por ese importe desde que venció) y la app aún no la ha
 *     registrado → NO es un impago: está pendiente de registrar (y su comisión aparecerá al registrarla).
 *  2. Stripe lo intentó y el cobro falló → impago real, con el motivo del banco.
 *  3. Sin ningún intento → el cobro no se ha lanzado todavía.
 */
export function clasificarImpago(
  cuota: { vencimiento: string; importe: number },
  pagosCliente: PagoStripeLite[],
  fallo: IntentoFallido | null,
  tolerancia = 0.5
): EstadoImpago {
  const desde = cuota.vencimiento.slice(0, 10)
  const pago = pagosCliente
    .filter((p) => p.status === 'succeeded' && !!p.paid_at && p.paid_at.slice(0, 10) >= desde)
    .filter((p) => Math.abs(p.amount - cuota.importe) <= Math.max(tolerancia, cuota.importe * 0.01))
    .sort((a, b) => String(b.paid_at).localeCompare(String(a.paid_at)))[0]
  if (pago) {
    return {
      tipo: 'pagado_pendiente_registro',
      fecha: pago.paid_at,
      texto: 'Tu cliente ya pagó en Stripe. Falta registrar el cobro y tu comisión aparecerá en cuanto se registre.',
    }
  }
  if (fallo) {
    const motivo = motivoDeRechazo(fallo)
    return { tipo: 'pago_rechazado', fecha: fallo.fecha ?? null, motivo, texto: `Pago rechazado: ${motivo}.` }
  }
  return { tipo: 'sin_intento', texto: 'Todavía no consta ningún intento de cobro de esta cuota.' }
}
