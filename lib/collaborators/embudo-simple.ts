// EMBUDO SENCILLO DE COLABORADORA: de las personas atribuidas a ella, cuántas agendaron, cuántas
// asistieron y cuántas cerraron. Nada de coste, ranking ni métricas del negocio: solo su gente.
//
// Puro (sin base de datos) para poder probarlo. Un hueco no es un cero: sin personas atribuidas no se
// inventa ninguna tasa.

import { isAttended, isCancelled } from '@/lib/appointments/status'
import { cuentaComoVenta } from '@/lib/analytics'

export type CitaSimple = { contact_id: string | null; status: string | null }
export type VentaSimple = Parameters<typeof cuentaComoVenta>[0] & { contact_id: string | null }

export type PersonaEmbudo = {
  id: string
  nombre: string | null
  agendo: boolean
  asistio: boolean
  cerro: boolean
  devuelto: boolean
}

export type EmbudoSimple = {
  personas: number
  agendaron: number
  asistieron: number
  cerraron: number
  /** Cierre sobre las que asistieron; `null` si nadie asistió todavía. */
  cierre: number | null
  lista: PersonaEmbudo[]
}

export function embudoSimple(
  contactos: readonly { id: string; full_name: string | null }[],
  citas: readonly CitaSimple[],
  ventas: readonly VentaSimple[]
): EmbudoSimple {
  const conAgenda = new Set<string>()
  const conAsistencia = new Set<string>()
  for (const c of citas) {
    if (!c.contact_id || isCancelled(c.status)) continue
    conAgenda.add(c.contact_id)
    if (isAttended(c.status)) conAsistencia.add(c.contact_id)
  }
  const conVenta = new Set<string>()
  const conDevolucion = new Set<string>()
  for (const v of ventas) {
    if (!v.contact_id) continue
    if (cuentaComoVenta(v)) conVenta.add(v.contact_id)
    else if (v.status === 'refunded') conDevolucion.add(v.contact_id)
  }
  const lista: PersonaEmbudo[] = contactos.map((c) => ({
    id: c.id,
    nombre: c.full_name,
    agendo: conAgenda.has(c.id),
    asistio: conAsistencia.has(c.id),
    cerro: conVenta.has(c.id),
    devuelto: conDevolucion.has(c.id) && !conVenta.has(c.id),
  }))
  const agendaron = lista.filter((p) => p.agendo).length
  const asistieron = lista.filter((p) => p.asistio).length
  const cerraron = lista.filter((p) => p.cerro).length
  return {
    personas: lista.length,
    agendaron,
    asistieron,
    cerraron,
    cierre: asistieron > 0 ? (cerraron / asistieron) * 100 : null,
    lista,
  }
}
