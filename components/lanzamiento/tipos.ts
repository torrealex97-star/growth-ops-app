// Tipos que comparten la pantalla de Lanzamientos y sus componentes. Reflejan la respuesta del GET
// de /api/[tenant]/evergreen/lanzamiento (lib/launch/panel.ts y lib/launch/lanzamientos.ts).

export type EstadoLanzamiento = 'programado' | 'abierto' | 'cerrado'

export type Lanzamiento = {
  id: string
  slug: string
  label: string
  fecha: string
  estado: EstadoLanzamiento
  abierto: boolean
  abiertoAt: string | null
  cerradoAt: string | null
}

export type Metricas = {
  leads: number
  confirmados: number
  muestraCompleta: boolean
  filasLeidas: number
  conEncuesta: number
  avgQuality: number | null
  avgQualityAnterior: number | null
  buenos: number
  edadMedia: number | null
  agendaron: number | null
  compraron: number | null
}

export type Anuncio = {
  anuncio: string
  variantes: number
  totalLeads: number
  conEncuesta: number
  avgQuality: number
  pctBuenos: number
  scoreComposite: number
  confirmados: number
  citas: number | null
  ventas: number | null
  muestraCorta: boolean
  porQue: string[]
}

export type Lead = {
  id: string
  nombre: string | null
  email: string | null
  phone: string | null
  fecha: string
  confirmado: boolean
  anuncio: string | null
  campana: string | null
  quality: number | null
  agendo: boolean | null
  compro: boolean | null
}

export type LeadDetalle = Lead & {
  respuestas: { q: string; a: string }[]
  desglose: { independencia: number; ingresos: number; ambicion: number; edad: number; relacionIA: number } | null
}

export type PanelResponse = {
  calendario: Lanzamiento[]
  activo: Lanzamiento | null
  siguiente: Lanzamiento | null
  visto: Lanzamiento | null
  puedeEditar: boolean
  motivoSoloLectura: string | null
  activoPasado: boolean
  metricas?: Metricas | null
  dias?: { fecha: string; leads: number; confirmados: number }[]
  anuncios?: Anuncio[]
  recientes?: Lead[]
  piden?: { tema: string; n: number; label: string }[]
  anunciosVistos?: string[]
}

export type ConexionResponse = {
  cabecera: string
  eventos: {
    id: string
    titulo: string
    query: string
    cuando: string
    obligatorio: boolean
    ruta: string
  }[]
  secretoConfigurado: boolean | null
  eventosLeidos: boolean
  ultimoEvento: string | null
  ultimoRechazo: string | null
  puedeConfigurar: boolean
}

/** Día del evento ("28 oct 2026") a partir de YYYY-MM-DD, sin que la zona horaria lo mueva de día. */
export const diaEvento = (f: string) =>
  new Date(`${f}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })

export const diaCorto = (f: string) =>
  new Date(`${f}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })

export const ETIQUETA_ESTADO: Record<EstadoLanzamiento, string> = {
  programado: 'Programado',
  abierto: 'Abierto',
  cerrado: 'Cerrado',
}
