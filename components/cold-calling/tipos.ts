// Tipos de las respuestas de /api/[tenant]/evergreen/cold-calling (lista) y …/manager (equipo).
import type { EstadoLead, TonoEstado } from '@/lib/cold-calling/estados'

export type Estado = { id: EstadoLead; label: string; ayuda: string; llamada: boolean; tono: TonoEstado }
export type LanzamientoCC = { id: string; label: string; fecha: string; abierto: boolean; estado: string }
export type Tramo = { desde: number; hasta: number | null; importe: number }

export type Lead = {
  id: string
  contactId: string
  callerId: string
  nombre: string
  phone: string | null
  email: string | null
  status: EstadoLead
  quality: number | null
  notes: string | null
  recordatorioAt: string | null
  intentos: number
  assignedAt: string
  updatedAt: string
  compro: boolean
}

export type Dinero =
  | { estado: 'exenta' }
  | { estado: 'sin_tramos'; ventas: number }
  | {
      estado: 'ok'
      firme: number
      enVentana: number
      ventas: number
      sinImporte: number
      detalle: {
        saleId: string
        numero: number
        importe: number | null
        fecha: string
        finDesistimiento: string | null
      }[]
    }

export type ListaResponse = {
  sinLista?: boolean
  lanzamientos: LanzamientoCC[]
  launch: LanzamientoCC | null
  soloLectura: boolean
  nombreVista: string | null
  estados?: Estado[]
  leads?: Lead[]
  leadsTruncados?: boolean
  stats?: {
    asignados: number
    porLlamar: number
    llamados: number
    intentos: number
    contactados: number
    confirmados: number
    ventas: number
  } | null
  ranking?: {
    posicion: number
    nombre: string
    soyYo: boolean
    llamados: number
    confirmados: number
    ventas: number
  }[]
  dinero?: Dinero
  tramos?: Tramo[]
  objetivoConfirmados?: number | null
  pedirMas?: { disponible: boolean; porLlamar: number; umbral: number; tanda: number; motivo: string | null }
}

export type StatsCaller = {
  callerId: string
  nombre: string
  activa: boolean
  asignados: number
  porLlamar: number
  llamados: number
  intentos: number
  contactados: number
  confirmados: number
  ventas: number
}

export type ManagerResponse = {
  lanzamientos: LanzamientoCC[]
  launch: LanzamientoCC | null
  ajustes: {
    tramos: Tramo[]
    tanda: number
    pedirMasSiQuedan: number
    objetivoConfirmados: number | null
    guardado: boolean
  }
  puedeConfigurar: boolean
  estados: Estado[]
  callers: { id: string; nombre: string; activa: boolean; comisiona: boolean }[]
  stats?: StatsCaller[]
  totales?: { asignados: number; porLlamar: number; confirmados: number; ventas: number; truncado: boolean }
  atencion?: (Lead & { caller: string; motivo: 'recordatorio_vencido' | 'sin_actividad' })[]
  diasInactivo?: number
  actividad?: {
    id: string
    cuando: string
    tipo: string
    status: string | null
    nota: string | null
    lead: string
    caller: string
    actor: string
    porOtraPersona: boolean
  }[]
  ventas?: {
    saleId: string
    caller: string
    lead: string
    numero: number
    importe: number | null
    fecha: string
    finDesistimiento: string | null
  }[]
  dinero?: { firme: number; enVentana: number; ventas: number; sinImporte: number } | null
  hayTramos?: boolean
}

/** Clases por tono del estado. El texto del estado va siempre: el color no es el único encoding. */
export const CLASE_TONO: Record<TonoEstado, string> = {
  neutro: 'border-border bg-muted text-muted-foreground',
  aviso: 'border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400',
  info: 'border-blue-500/30 bg-blue-500/15 text-blue-600 dark:text-blue-400',
  bien: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  mal: 'border-red-500/30 bg-red-500/15 text-red-600 dark:text-red-400',
}

export function textoTramos(tramos: Tramo[], dinero: (n: number) => string): string[] {
  return tramos.map((t) =>
    t.hasta === null
      ? `De la venta ${t.desde} en adelante: ${dinero(t.importe)} por venta`
      : t.desde === t.hasta
        ? `Venta ${t.desde}: ${dinero(t.importe)}`
        : `Ventas ${t.desde} a ${t.hasta}: ${dinero(t.importe)} por venta`
  )
}
