// PANEL DE TRÁFICO WEB (estilo Plausible/Umami) sobre canonical_events del pixel propio.
// Puro y sin I/O. Se cuentan PERSONAS (visitor_id) y SESIONES distintas, no filas: una recarga no es
// otra visita. La fuente sale de utm_source de la URL y, si no hay, del referrer (mismo criterio que
// la ingesta: deriveChannel). Los bots no se pueden separar aquí: la ingesta los guarda en raw_events
// pero no marca el evento canónico.
import { deriveChannel } from '@/lib/tracking/ingest'

export type EventoTrafico = {
  visitor_id: string | null
  session_id: string | null
  event_name: string
  url: string | null
  referrer: string | null
  occurred_at: string
}

export type FilaConteo = { clave: string; visitantes: number; porcentaje: number }

export type ResumenTrafico = {
  visitantes: number
  sesiones: number
  paginasVistas: number
  /** Visitantes que dejaron un lead o compra, sobre visitantes. null sin visitantes. */
  conversion: number | null
  topPaginas: FilaConteo[]
  topFuentes: FilaConteo[]
}

const EVENTOS_VISTA = new Set(['page_view', 'landing_view'])
const EVENTOS_CONVERSION = new Set(['lead', 'form_submit', 'appointment_booked', 'purchase'])

/** Ruta sin dominio ni query ('/oferta?x=1' → '/oferta'). Si la URL no se puede leer, null. */
export function rutaDe(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const p = new URL(url).pathname.replace(/\/+$/, '')
    return p || '/'
  } catch {
    return null
  }
}

function fuenteDe(url: string | null, referrer: string | null): string {
  let utm: string | null = null
  try {
    utm = url ? new URL(url).searchParams.get('utm_source') : null
  } catch {
    utm = null
  }
  // Un referrer del propio sitio no es una fuente: se trata como directo.
  let ref = referrer
  try {
    if (url && referrer && new URL(url).hostname === new URL(referrer).hostname) ref = null
  } catch {
    ref = null
  }
  return deriveChannel(utm, ref)
}

function top(mapa: Map<string, Set<string>>, totalVisitantes: number, n: number): FilaConteo[] {
  return [...mapa.entries()]
    .map(([clave, set]) => ({
      clave,
      visitantes: set.size,
      porcentaje: totalVisitantes ? (set.size / totalVisitantes) * 100 : 0,
    }))
    .sort((a, b) => b.visitantes - a.visitantes || a.clave.localeCompare(b.clave))
    .slice(0, n)
}

export function calcularTraficoWeb(eventos: EventoTrafico[], opciones: { top?: number } = {}): ResumenTrafico {
  const n = opciones.top ?? 8
  const visitantes = new Set<string>()
  const sesiones = new Set<string>()
  const convertidos = new Set<string>()
  const porPagina = new Map<string, Set<string>>()
  const porFuente = new Map<string, Set<string>>()
  // Una sola fuente por visitante: la de su primera visita del periodo (atribución de entrada).
  const primeraFuente = new Map<string, string>()
  let paginasVistas = 0

  // Orden cronológico: la «primera fuente» de cada visitante depende de él, no del orden de lectura.
  const ordenados = [...eventos].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
  for (const e of ordenados) {
    const v = e.visitor_id
    if (!v) continue
    if (EVENTOS_CONVERSION.has(e.event_name)) convertidos.add(v)
    if (!EVENTOS_VISTA.has(e.event_name)) continue
    visitantes.add(v)
    paginasVistas += 1
    if (e.session_id) sesiones.add(e.session_id)
    const ruta = rutaDe(e.url)
    if (ruta) porPagina.set(ruta, (porPagina.get(ruta) ?? new Set()).add(v))
    if (!primeraFuente.has(v)) primeraFuente.set(v, fuenteDe(e.url, e.referrer))
  }
  for (const [v, f] of primeraFuente) porFuente.set(f, (porFuente.get(f) ?? new Set()).add(v))

  const conversores = [...convertidos].filter((v) => visitantes.has(v)).length
  return {
    visitantes: visitantes.size,
    sesiones: sesiones.size,
    paginasVistas,
    conversion: visitantes.size ? (conversores / visitantes.size) * 100 : null,
    topPaginas: top(porPagina, visitantes.size, n),
    topFuentes: top(porFuente, visitantes.size, n),
  }
}
