// FUNNEL POR EVENTOS (pasos configurables, estilo PostHog) sobre canonical_events.
//
// Diferencia con lib/funnels (que cuenta sesiones por etapa de forma independiente): aquí cada
// persona tiene que recorrer los pasos EN ORDEN y dentro de una ventana desde su primer paso. Así
// "agendaron" solo cuenta a quien antes llegó a la landing, y el abandono por paso es real.
//
// Puro y sin I/O: la consulta vive en la ruta API. Una persona es `visitor_id`; si el evento no lo
// trae pero sí `contact_id` (eventos de CRM), se usa el contacto. Eventos sin ninguna de las dos
// claves se cuentan aparte (`sinIdentidad`) en vez de inventar una persona.

export type EventoFila = {
  visitor_id: string | null
  contact_id: string | null
  event_name: string
  occurred_at: string
}

export type PasoFunnel = {
  id: string
  label: string
  /** Nombres de evento que cuentan como este paso (cualquiera de ellos). */
  eventos: string[]
}

export type PasoResultado = {
  id: string
  label: string
  personas: number
  /** % respecto al paso anterior (null en el primero o si el anterior es 0). */
  conversionDesdeAnterior: number | null
  /** % respecto al primer paso. */
  conversionDesdeTope: number | null
  /** Personas que llegaron al paso anterior y no a este. */
  abandonados: number
}

export type ResultadoFunnelEventos = {
  pasos: PasoResultado[]
  entraron: number
  sinIdentidad: number
}

export const VENTANA_HORAS_POR_DEFECTO = 72

/**
 * Pasos por defecto, con los nombres que realmente emite el pixel (ALLOWED_EVENTS de
 * app/api/track/[site]/route.ts).
 */
export const PASOS_POR_DEFECTO: PasoFunnel[] = [
  { id: 'visita', label: 'Visita', eventos: ['page_view', 'landing_view'] },
  { id: 'interes', label: 'Interés (CTA / VSL)', eventos: ['cta_click', 'vsl_view', 'form_start'] },
  { id: 'lead', label: 'Lead', eventos: ['lead', 'form_submit'] },
  { id: 'agenda', label: 'Agenda', eventos: ['appointment_booked'] },
  { id: 'asistio', label: 'Asistió', eventos: ['appointment_attended'] },
  { id: 'compra', label: 'Compra', eventos: ['purchase'] },
]

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null)

/** Profundidad máxima alcanzada por una persona (nº de pasos recorridos en orden y en ventana). */
function profundidad(eventos: { t: number; paso: number[] }[], nPasos: number, ventanaMs: number): number {
  let mejor = 0
  // Se prueba cada aparición del paso 0 como inicio: anclar solo en la primera podría dejar fuera
  // una cadena válida que empieza más tarde y cabe en la ventana.
  for (let i = 0; i < eventos.length; i++) {
    if (!eventos[i].paso.includes(0)) continue
    const inicio = eventos[i].t
    let actual = 0
    let desde = i
    for (let k = 1; k < nPasos; k++) {
      let encontrado = -1
      for (let j = desde; j < eventos.length; j++) {
        if (eventos[j].t - inicio > ventanaMs) break
        // Un mismo evento no sirve para dos pasos: se exige uno posterior (índice mayor).
        if (j > desde && eventos[j].paso.includes(k)) {
          encontrado = j
          break
        }
      }
      if (encontrado < 0) break
      actual = k
      desde = encontrado
    }
    mejor = Math.max(mejor, actual + 1)
    if (mejor === nPasos) break
  }
  return mejor
}

export function calcularFunnelEventos(
  eventos: EventoFila[],
  pasos: PasoFunnel[] = PASOS_POR_DEFECTO,
  opciones: { ventanaHoras?: number } = {}
): ResultadoFunnelEventos {
  const ventanaMs = (opciones.ventanaHoras ?? VENTANA_HORAS_POR_DEFECTO) * 3_600_000
  // nombre de evento → índices de paso en los que cuenta
  const pasosDeEvento = new Map<string, number[]>()
  pasos.forEach((p, i) => p.eventos.forEach((n) => pasosDeEvento.set(n, [...(pasosDeEvento.get(n) ?? []), i])))

  const porPersona = new Map<string, { t: number; paso: number[] }[]>()
  let sinIdentidad = 0
  for (const e of eventos) {
    const paso = pasosDeEvento.get(e.event_name)
    if (!paso) continue
    const clave = e.visitor_id ? `v:${e.visitor_id}` : e.contact_id ? `c:${e.contact_id}` : null
    if (!clave) {
      sinIdentidad += 1
      continue
    }
    const t = new Date(e.occurred_at).getTime()
    if (!Number.isFinite(t)) continue
    const lista = porPersona.get(clave) ?? []
    lista.push({ t, paso })
    porPersona.set(clave, lista)
  }

  // alcanzaron[k] = personas que llegaron AL MENOS al paso k
  const alcanzaron = new Array<number>(pasos.length).fill(0)
  for (const lista of porPersona.values()) {
    lista.sort((a, b) => a.t - b.t)
    const prof = profundidad(lista, pasos.length, ventanaMs)
    for (let k = 0; k < prof; k++) alcanzaron[k] += 1
  }

  const tope = alcanzaron[0] ?? 0
  return {
    entraron: tope,
    sinIdentidad,
    pasos: pasos.map((p, k) => ({
      id: p.id,
      label: p.label,
      personas: alcanzaron[k],
      conversionDesdeAnterior: k === 0 ? null : pct(alcanzaron[k], alcanzaron[k - 1]),
      conversionDesdeTope: pct(alcanzaron[k], tope),
      abandonados: k === 0 ? 0 : Math.max(0, alcanzaron[k - 1] - alcanzaron[k]),
    })),
  }
}
