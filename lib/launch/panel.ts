import {
  computeAdQuality,
  desgloseCalidad,
  edadAprox,
  qualityScore,
  qualityScoreJunio,
  resolveFields,
  TEMAS_PIDEN,
  temasDe,
  UMBRAL_LEAD_BUENO,
  type DesgloseCalidad,
  type LeadForQuality,
  type Qualification,
} from './calidad'

// AGREGADO DEL PANEL DE UN LANZAMIENTO. Función pura, sin BD: recibe las filas tal cual las devuelve
// PostgREST y calcula lo que pinta la pantalla. Vive aparte de la ruta para poder probarla con filas
// reales — el panel estuvo devolviendo 500 con un solo lead porque el código leía una forma de fila
// (`f.contact_launches.created_at`) que la consulta nunca devolvió, y ningún test pasaba una fila.
//
// FORMA DE LA FILA: `from('contact_launches').select('id, …, contacts!inner(…)')` devuelve las
// columnas de `contact_launches` en el primer nivel y `contacts` anidado. No hay envoltorio.

export type FilaPanel = {
  id: string
  created_at: string
  confirmed_at: string | null
  utm: Record<string, string> | null
  contact_id: string
  contacts: {
    full_name: string | null
    email: string | null
    phone: string | null
    qualification: Record<string, unknown> | null
  } | null
}

/** Cruce con agendas y ventas. `null` en un recuento = no se pudo leer (hueco), nunca cero. */
export type ConversionesPanel = {
  conCita: Set<string>
  conVenta: Set<string>
  agendasLeidas: boolean
  ventasLeidas: boolean
}

export type MetricasPanel = {
  /** Apuntados al lanzamiento, contados en Postgres (no depende de la muestra). */
  leads: number
  /** Confirmaron asistencia, contados en Postgres. */
  confirmados: number
  /** false = las cifras de detalle (calidad, anuncios, días) salen de una muestra cortada. */
  muestraCompleta: boolean
  /** Filas realmente leídas para el detalle. */
  filasLeidas: number
  conEncuesta: number
  avgQuality: number | null
  /** Nota media con el criterio anterior, para comparar la evolución. */
  avgQualityAnterior: number | null
  buenos: number
  edadMedia: number | null
  /** Contactos con una cita no cancelada creada desde el primer apuntado. null = sin leer. */
  agendaron: number | null
  /** Contactos con una venta activa (una reserva sin completar NO cuenta). null = sin leer. */
  compraron: number | null
}

export type LeadPanel = {
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

export type LeadDetalle = LeadPanel & {
  respuestas: { q: string; a: string }[]
  desglose: DesgloseCalidad | null
}

const MAX_DIAS = 60
const MAX_ANUNCIOS = 12
const MAX_RECIENTES = 8

const campos = (f: FilaPanel) => resolveFields((f.contacts?.qualification ?? null) as Qualification | null)

const media = (xs: number[], decimales = 1): number | null => {
  if (xs.length === 0) return null
  const factor = 10 ** decimales
  return Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * factor) / factor
}

function aLead(f: FilaPanel, fields: Record<string, string>, c: ConversionesPanel | null): LeadPanel {
  return {
    id: f.id,
    nombre: f.contacts?.full_name ?? null,
    email: f.contacts?.email ?? null,
    phone: f.contacts?.phone ?? null,
    fecha: f.created_at,
    confirmado: Boolean(f.confirmed_at),
    anuncio: f.utm?.utm_content ?? null,
    campana: f.utm?.utm_campaign ?? null,
    quality: qualityScore(fields),
    agendo: c?.agendasLeidas ? c.conCita.has(f.contact_id) : null,
    compro: c?.ventasLeidas ? c.conVenta.has(f.contact_id) : null,
  }
}

/** Una fila como lead de tabla, con sus respuestas y el desglose de la nota (panel lateral). */
export function leadDetalle(f: FilaPanel, c: ConversionesPanel | null = null): LeadDetalle {
  const fields = campos(f)
  const crudas = (f.contacts?.qualification as Qualification | null)?.respuestas
  const respuestas = Array.isArray(crudas)
    ? crudas
        .filter((r) => r && typeof r.q === 'string' && typeof r.a === 'string' && r.a.trim() !== '')
        .map((r) => ({ q: r.q, a: r.a }))
    : []
  const lead = aLead(f, fields, c)
  return { ...lead, respuestas, desglose: lead.quality === null ? null : desgloseCalidad(fields) }
}

export function agregarPanel(
  /** Filas del lanzamiento, de la más reciente a la más antigua. */
  filas: FilaPanel[],
  e: {
    total: number
    confirmados: number
    truncado: boolean
    conversiones: ConversionesPanel | null
  }
) {
  const c = e.conversiones
  const leadsParaCalidad: LeadForQuality[] = []
  const calidades: number[] = []
  const calidadesAnterior: number[] = []
  const edades: number[] = []
  const piden: Record<string, number> = {}
  const porDia = new Map<string, { leads: number; confirmados: number }>()
  const recientes: LeadPanel[] = []
  const anunciosVistos = new Set<string>()

  for (const f of filas) {
    const fields = campos(f)
    const quality = qualityScore(fields)
    const qualityJunio = qualityScoreJunio(fields)

    const dia = (f.created_at ?? '').slice(0, 10)
    if (dia) {
      const delDia = porDia.get(dia) ?? { leads: 0, confirmados: 0 }
      delDia.leads += 1
      if (f.confirmed_at) delDia.confirmados += 1
      porDia.set(dia, delDia)
    }

    const anuncio = f.utm?.utm_content ?? null
    if (anuncio) anunciosVistos.add(anuncio)
    leadsParaCalidad.push({
      id: f.id,
      anuncio,
      campana: f.utm?.utm_campaign ?? null,
      fields,
      quality,
      qualityJunio,
      citas: c?.agendasLeidas && c.conCita.has(f.contact_id) ? 1 : 0,
      ventas: c?.ventasLeidas && c.conVenta.has(f.contact_id) ? 1 : 0,
      confirmado: Boolean(f.confirmed_at),
    })
    if (quality !== null) calidades.push(quality)
    if (qualityJunio !== null) calidadesAnterior.push(qualityJunio)
    const edad = edadAprox(fields.edad)
    if (edad !== null) edades.push(edad)
    // Pregunta abierta: temas por palabras clave, deterministas; las respuestas basura caen en
    // no_sabe/otros y no se cuentan.
    if (fields.que_piden) {
      for (const tema of temasDe(fields.que_piden)) {
        if (tema === 'no_sabe' || tema === 'otros') continue
        piden[tema] = (piden[tema] ?? 0) + 1
      }
    }
    if (recientes.length < MAX_RECIENTES) recientes.push(aLead(f, fields, c))
  }

  const contactos = new Set(filas.map((f) => f.contact_id))
  const cuenta = (ids: Set<string>) => [...ids].filter((id) => contactos.has(id)).length

  const metricas: MetricasPanel = {
    leads: e.total,
    confirmados: e.confirmados,
    muestraCompleta: !e.truncado && filas.length >= e.total,
    filasLeidas: filas.length,
    conEncuesta: calidades.length,
    avgQuality: media(calidades),
    avgQualityAnterior: media(calidadesAnterior),
    buenos: calidades.filter((n) => n >= UMBRAL_LEAD_BUENO).length,
    edadMedia: media(edades, 0),
    // Con la muestra cortada el cruce solo cubre una parte: se deja como hueco antes que dar un
    // recuento parcial con apariencia de total.
    agendaron: c?.agendasLeidas && !e.truncado ? cuenta(c.conCita) : null,
    compraron: c?.ventasLeidas && !e.truncado ? cuenta(c.conVenta) : null,
  }

  const dias = [...porDia.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-MAX_DIAS)
    .map(([fecha, v]) => ({ fecha, ...v }))

  const anuncios = computeAdQuality(leadsParaCalidad)
    .slice(0, MAX_ANUNCIOS)
    .map((a) => ({
      anuncio: a.anuncio,
      variantes: a.variantes.length,
      totalLeads: a.totalLeads,
      conEncuesta: a.conEncuesta,
      avgQuality: a.avgQuality,
      pctBuenos: a.pctBuenos,
      scoreComposite: a.scoreComposite,
      confirmados: a.confirmados,
      // null = el cruce no se pudo leer. Un 0 aquí significa "leído y nadie agendó/compró".
      citas: c?.agendasLeidas ? a.citas : null,
      ventas: c?.ventasLeidas ? a.ventas : null,
      muestraCorta: a.muestraCorta,
      porQue: a.porQue,
    }))

  const pidenOrdenado = Object.entries(piden)
    .map(([tema, n]) => ({ tema, n, label: TEMAS_PIDEN.find((t) => t.id === tema)?.label ?? tema }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 6)

  return {
    metricas,
    dias,
    anuncios,
    recientes,
    piden: pidenOrdenado,
    /** Valores de utm_content vistos, para el filtro de la tabla de leads. */
    anunciosVistos: [...anunciosVistos].sort().slice(0, 200),
  }
}

/** Texto libre de búsqueda → seguro para un filtro `or()` de PostgREST (sin sintaxis que inyectar). */
export function limpiarBusqueda(texto: string | null | undefined): string {
  return (texto ?? '')
    .replace(/[,()*%\\"'`:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

const celdaCsv = (v: string | number | boolean | null): string => {
  if (v === null || v === '') return ''
  let s = String(v)
  // Una celda que empieza por = + - @ la ejecuta Excel como fórmula: los nombres y respuestas vienen
  // de un formulario público, así que se neutraliza con un apóstrofo.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV de los leads del lanzamiento (separador `;`, que es el que abre Excel en español). */
export function leadsACsv(leads: LeadPanel[]): string {
  const cabecera = [
    'Nombre',
    'Email',
    'Teléfono',
    'Apuntado',
    'Confirmado',
    'Calidad',
    'Agendó',
    'Compró',
    'Anuncio',
    'Campaña',
  ]
  const siNo = (b: boolean | null) => (b === null ? '' : b ? 'sí' : 'no')
  const lineas = leads.map((l) =>
    [
      l.nombre,
      l.email,
      l.phone,
      l.fecha,
      siNo(l.confirmado),
      l.quality,
      siNo(l.agendo),
      siNo(l.compro),
      l.anuncio,
      l.campana,
    ]
      .map(celdaCsv)
      .join(';')
  )
  return [cabecera.join(';'), ...lineas].join('\r\n')
}
