// HERRAMIENTAS DE LISTADO DEL MCP: agendas (appointments) y ventas (sales). Puras: validan los argumentos del modelo
// y construyen el SQL. El aislamiento por subcuenta y por rol lo pone el RLS del usuario que autorizó (sql-executor),
// no este módulo.
//
// SEGURIDAD: nada que escribe el modelo entra al SQL sin pasar por una validación estricta (fechas AAAA-MM-DD,
// estados [a-z_], límite numérico acotado). No se devuelven columnas pesadas ni sensibles (raw_payload, transcript,
// análisis de IA, documentos del alumno, comprobantes de pago).
//
// DINERO (docs/MONEY.md): estos listados NO calculan totales ni redefinen KPIs. `gross_amount` es lo RESERVADO/pactado,
// no lo cobrado; una reserva sin completar no es una venta (D8). El modelo recibe `reservation_completed_at` y el
// estado para distinguirlo, y las fórmulas canónicas viven en la app.

export const LIMITE_POR_DEFECTO = 50
export const LIMITE_MAXIMO = 100

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const ESTADO = /^[a-z][a-z0-9_]{0,39}$/

export type FiltrosListado = { desde: string | null; hasta: string | null; estado: string | null; limite: number }
export type ResultadoFiltros = { ok: true; filtros: FiltrosListado } | { ok: false; error: string }

function fechaValida(v: unknown): string | null | 'mala' {
  if (v === undefined || v === null || v === '') return null
  if (typeof v !== 'string' || !FECHA.test(v)) return 'mala'
  const d = new Date(`${v}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? 'mala' : v
}

export function leerFiltros(args: Record<string, unknown>): ResultadoFiltros {
  const desde = fechaValida(args.desde)
  const hasta = fechaValida(args.hasta)
  if (desde === 'mala') return { ok: false, error: 'desde debe ser una fecha AAAA-MM-DD' }
  if (hasta === 'mala') return { ok: false, error: 'hasta debe ser una fecha AAAA-MM-DD' }
  if (desde && hasta && desde > hasta) return { ok: false, error: 'desde no puede ser posterior a hasta' }
  let estado: string | null = null
  if (args.estado !== undefined && args.estado !== null && args.estado !== '') {
    if (typeof args.estado !== 'string' || !ESTADO.test(args.estado))
      return { ok: false, error: 'estado solo admite minúsculas, números y guion bajo' }
    estado = args.estado
  }
  const bruto = typeof args.limite === 'number' ? Math.trunc(args.limite) : LIMITE_POR_DEFECTO
  const limite = Math.min(Math.max(Number.isFinite(bruto) ? bruto : LIMITE_POR_DEFECTO, 1), LIMITE_MAXIMO)
  return { ok: true, filtros: { desde, hasta, estado, limite } }
}

export function sqlAgendas(f: FiltrosListado): string {
  const where = [
    f.desde ? `a.appointment_datetime >= '${f.desde}'::date` : '',
    f.hasta ? `a.appointment_datetime < ('${f.hasta}'::date + 1)` : '',
    f.estado ? `a.status = '${f.estado}'` : '',
  ].filter(Boolean)
  return (
    `select a.id, a.appointment_datetime, a.status, a.result, a.appointment_type, a.event_type, a.source, ` +
    `a.utm_source, a.utm_campaign, a.duration_minutes, c.full_name as contacto, closer.full_name as closer, ` +
    `setter.full_name as setter, t.slug as subcuenta ` +
    `from appointments a join tenants t on t.id = a.tenant_id ` +
    `left join contacts c on c.id = a.contact_id ` +
    `left join users closer on closer.id = a.closer_id left join users setter on setter.id = a.setter_id ` +
    (where.length ? `where ${where.join(' and ')} ` : '') +
    `order by a.appointment_datetime desc limit ${f.limite}`
  )
}

export function sqlVentas(f: FiltrosListado): string {
  const where = [
    f.desde ? `s.sale_date >= '${f.desde}'::date` : '',
    f.hasta ? `s.sale_date <= '${f.hasta}'::date` : '',
    f.estado ? `s.status = '${f.estado}'` : '',
  ].filter(Boolean)
  return (
    `select s.id, s.sale_date, s.status, s.gross_amount, s.discount, s.reservation_amount, s.reservation_completed_at, ` +
    `s.payment_method, s.is_upsell, c.full_name as contacto, closer.full_name as closer, t.slug as subcuenta ` +
    `from sales s join tenants t on t.id = s.tenant_id ` +
    `left join contacts c on c.id = s.contact_id left join users closer on closer.id = s.closer_id ` +
    (where.length ? `where ${where.join(' and ')} ` : '') +
    `order by s.sale_date desc limit ${f.limite}`
  )
}
