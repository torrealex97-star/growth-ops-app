// «MI DÍA»: lo que cada persona del equipo necesita para trabajar hoy, calculado solo con SUS citas.
//
// Puro (sin base de datos) para poder probarlo. Qué cuenta como cada cosa:
//   · Hoy: citas del día (zona del negocio) que no están canceladas.
//   · Por marcar: citas YA pasadas cuyo estado nadie ha resuelto (scheduled/confirmed/rescheduled). Es
//     la lista que más vale: sin asistencia marcada no hay show rate ni close rate fiables.
//   · Próximas: citas futuras en los siguientes 7 días.

import { businessToday, addDaysYmd } from '@/lib/dates/business'
import { ESTADOS_SIN_RESOLVER, isAttended, isNoShow } from '@/lib/appointments/status'

export type CitaMiDia = {
  id: string
  appointment_datetime: string
  status: string | null
  contacto: string | null
}

export type ResumenMiDia = {
  hoy: CitaMiDia[]
  porMarcar: CitaMiDia[]
  proximas7: CitaMiDia[]
}

const CANCELADAS = new Set(['cancelled', 'canceled'])

const dia = (iso: string) => businessToday(new Date(iso))

export function resumenMiDia(citas: readonly CitaMiDia[], ahora: Date = new Date()): ResumenMiDia {
  const hoyYmd = businessToday(ahora)
  const hasta = addDaysYmd(hoyYmd, 7)
  const t = ahora.getTime()
  const vivas = citas.filter((c) => !CANCELADAS.has(c.status ?? ''))
  const porFecha = (a: CitaMiDia, b: CitaMiDia) =>
    Date.parse(a.appointment_datetime) - Date.parse(b.appointment_datetime)
  return {
    hoy: vivas.filter((c) => dia(c.appointment_datetime) === hoyYmd).sort(porFecha),
    porMarcar: vivas
      .filter(
        (c) =>
          Date.parse(c.appointment_datetime) < t &&
          (!c.status || (ESTADOS_SIN_RESOLVER as readonly string[]).includes(c.status))
      )
      .sort((a, b) => porFecha(b, a)),
    proximas7: vivas
      .filter((c) => {
        const d = dia(c.appointment_datetime)
        return Date.parse(c.appointment_datetime) >= t && d > hoyYmd && d <= hasta
      })
      .sort(porFecha),
  }
}

/** Columna de `appointments` que identifica «mis» citas según el rol. `null` = el rol no tiene citas propias. */
export function columnaDeMisCitas(rol: string): 'closer_id' | 'setter_id' | 'cold_caller_id' | null {
  if (rol === 'closer') return 'closer_id'
  if (rol === 'setter') return 'setter_id'
  if (rol === 'cold_caller') return 'cold_caller_id'
  return null
}

export type TasasMiDia = {
  /** Asistidas / (asistidas + no show) en las citas ya resueltas. `null` = sin citas resueltas: un hueco, no un 0. */
  show: number | null
  /** Ventas del mes / asistidas del mes. `null` = sin asistidas este mes. */
  cierre: number | null
  asistidasMes: number
}

/**
 * Tasas personales. El denominador del show son solo citas RESUELTAS: las pendientes de marcar no
 * cuentan ni a favor ni en contra (por eso «Por marcar» importa: sin marcar no hay tasa fiable).
 */
export function tasasMiDia(citas: readonly CitaMiDia[], ventasMes: number, ahora: Date = new Date()): TasasMiDia {
  const mes = businessToday(ahora).slice(0, 7)
  let asist = 0
  let noShow = 0
  let asistMes = 0
  for (const c of citas) {
    if (isAttended(c.status)) {
      asist++
      if (dia(c.appointment_datetime).startsWith(mes)) asistMes++
    } else if (isNoShow(c.status)) noShow++
  }
  return {
    show: asist + noShow > 0 ? (asist / (asist + noShow)) * 100 : null,
    cierre: asistMes > 0 ? (ventasMes / asistMes) * 100 : null,
    asistidasMes: asistMes,
  }
}
