// Filtros por MESES (nunca por días) para facturas y pagos de colaboradores, y resumen del libro de comisiones por mes.
export type PresetMeses = 'mes' | 'anterior' | 'trimestre' | 'semestre' | 'anio' | 'rango'
export type RangoMeses = { desde: string; hasta: string } // YYYY-MM, ambos incluidos

export const PRESETS_MESES: { value: PresetMeses; label: string }[] = [
  { value: 'mes', label: 'Este mes' },
  { value: 'anterior', label: 'Mes anterior' },
  { value: 'trimestre', label: 'Este trimestre' },
  { value: 'semestre', label: 'Este semestre' },
  { value: 'anio', label: 'Este año' },
  { value: 'rango', label: 'Rango de meses' },
]

export function sumarMes(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** hoyYm = mes actual (YYYY-MM). Para 'rango' se usan los extremos dados (se ordenan si vienen al revés). */
export function rangoDeMeses(preset: PresetMeses, hoyYm: string, desde = '', hasta = ''): RangoMeses {
  const y = hoyYm.slice(0, 4)
  const m = Number(hoyYm.slice(5, 7))
  switch (preset) {
    case 'anterior':
      return { desde: sumarMes(hoyYm, -1), hasta: sumarMes(hoyYm, -1) }
    case 'trimestre': {
      const ini = Math.floor((m - 1) / 3) * 3 + 1
      return { desde: `${y}-${String(ini).padStart(2, '0')}`, hasta: `${y}-${String(ini + 2).padStart(2, '0')}` }
    }
    case 'semestre':
      return m <= 6 ? { desde: `${y}-01`, hasta: `${y}-06` } : { desde: `${y}-07`, hasta: `${y}-12` }
    case 'anio':
      return { desde: `${y}-01`, hasta: `${y}-12` }
    case 'rango': {
      const a = /^\d{4}-\d{2}$/.test(desde) ? desde : hoyYm
      const b = /^\d{4}-\d{2}$/.test(hasta) ? hasta : a
      return a <= b ? { desde: a, hasta: b } : { desde: b, hasta: a }
    }
    default:
      return { desde: hoyYm, hasta: hoyYm }
  }
}

export const enRangoMeses = (ym: string, r: RangoMeses) => ym >= r.desde && ym <= r.hasta

/** Todo lo que el colaborador genera en un mes se paga el mes siguiente (generado oct → pago nov), suba cuando suba la factura. */
export const mesDePagoPrevisto = (mesGenerado: string) => sumarMes(mesGenerado, 1)

export type FilaLibro = {
  participant_type: string
  status: string
  direction?: string | null
  commission_amount: number | string | null
  liquidation_month?: string | null
  created_at: string
}
export type ResumenMesPago = { mes: string; pagado: number; porPagar: number }

/** Comisiones de colaboradores por MES DE PAGO (liquidation_month): liquidated = pagado; approved/pending = por pagar. */
export function resumenPagosPorMes(rows: FilaLibro[]): ResumenMesPago[] {
  const out = new Map<string, ResumenMesPago>()
  for (const r of rows) {
    if (r.participant_type !== 'collaborator' && r.participant_type !== 'affiliate') continue
    if (r.status === 'cancelled') continue
    const mes = String(r.liquidation_month || r.created_at || '').slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(mes)) continue
    const importe = Number(r.commission_amount || 0) * (r.direction === 'negative' ? -1 : 1)
    const f = out.get(mes) ?? { mes, pagado: 0, porPagar: 0 }
    if (r.status === 'liquidated') f.pagado += importe
    else f.porPagar += importe
    out.set(mes, f)
  }
  return [...out.values()]
    .map((f) => ({ ...f, pagado: Math.round(f.pagado * 100) / 100, porPagar: Math.round(f.porPagar * 100) / 100 }))
    .sort((a, b) => a.mes.localeCompare(b.mes))
}
