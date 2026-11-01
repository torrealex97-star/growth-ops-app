import type { AdQuality } from './calidad'

// Informe del lanzamiento: núcleo PURO (sin red ni base de datos). Dos mitades, como pide la
// metodología: DATA (qué pasó, medido) y ACCIONES (qué cambiar por culpa de eso). Reglas de rigor:
//   · cada porcentaje lleva su n al lado,
//   · un dato que no se puede medir se dice («no disponible»), nunca se rellena con un 0,
//   · las recomendaciones salen de una cifra del propio lanzamiento, nunca genéricas.

// ── Embudo ─────────────────────────────────────────────────────────────────────

export type DatosEmbudo = {
  registrados: number
  confirmados: number
  invitados: number
  /** null = fuente no conectada o sin cruzar (NO es lo mismo que 0). */
  agendados: number | null
  asistieron: number | null
  ventas: number | null
}

export type PasoEmbudo = {
  id: string
  etiqueta: string
  n: number | null
  /** % sobre el paso anterior CON dato; null si falta este paso o el anterior. */
  pctSobreAnterior: number | null
  pctSobreRegistrados: number | null
}

const redondeo = (x: number) => Math.round(x * 10) / 10

export function construirEmbudo(d: DatosEmbudo): PasoEmbudo[] {
  const pasos: { id: string; etiqueta: string; n: number | null }[] = [
    { id: 'registrados', etiqueta: 'Registrados', n: d.registrados },
    { id: 'confirmados', etiqueta: 'Confirmaron asistencia', n: d.confirmados },
    { id: 'invitados', etiqueta: 'Invitados desde el panel', n: d.invitados },
    { id: 'agendados', etiqueta: 'Agendaron llamada', n: d.agendados },
    { id: 'asistieron', etiqueta: 'Asistieron a la llamada', n: d.asistieron },
    { id: 'ventas', etiqueta: 'Ventas', n: d.ventas },
  ]
  let anterior: number | null = null
  return pasos.map((p) => {
    const pctSobreAnterior = p.n !== null && anterior !== null && anterior > 0 ? redondeo((p.n / anterior) * 100) : null
    const pctSobreRegistrados = p.n !== null && d.registrados > 0 ? redondeo((p.n / d.registrados) * 100) : null
    // «anterior» solo avanza con pasos que tienen dato: un hueco no rompe la lectura de los demás.
    if (p.n !== null && p.id !== 'invitados') anterior = p.n
    return { ...p, pctSobreAnterior, pctSobreRegistrados }
  })
}

// ── Veredicto por anuncio ──────────────────────────────────────────────────────

export type Veredicto = 'escalar' | 'mantener' | 'apagar' | 'muestra_corta'

/** Un anuncio sube a «escalar» si su calidad media supera la del lanzamiento en este factor. */
export const FACTOR_ESCALAR = 1.1
/** … y baja a «apagar» si queda por debajo de este. Entre ambos, «mantener». */
export const FACTOR_APAGAR = 0.9

export type ReferenciaLanzamiento = { avgQuality: number | null; pctBuenos: number | null }

export function veredictoAnuncio(ad: AdQuality, ref: ReferenciaLanzamiento): Veredicto {
  if (ad.muestraCorta || ref.avgQuality === null || ref.avgQuality <= 0) return 'muestra_corta'
  const razon = ad.avgQuality / ref.avgQuality
  const masBuenos = ref.pctBuenos === null || ad.pctBuenos >= ref.pctBuenos
  if (razon >= FACTOR_ESCALAR && masBuenos) return 'escalar'
  if (razon <= FACTOR_APAGAR && !masBuenos) return 'apagar'
  return 'mantener'
}

// ── Voz del mercado ────────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

export type ItemDistribucion = { texto: string; n: number; pct: number }

/** Reparto de respuestas iguales (opción múltiple). Devuelve los `max` más frecuentes y la base. */
export function distribucion(respuestas: (string | null | undefined)[], max = 6) {
  const validas = respuestas.map((r) => (r ?? '').trim()).filter((r) => r.length > 0)
  const cuenta = new Map<string, { texto: string; n: number }>()
  for (const r of validas) {
    const k = norm(r)
    const e = cuenta.get(k)
    if (e) e.n += 1
    else cuenta.set(k, { texto: r, n: 1 })
  }
  const base = validas.length
  const items: ItemDistribucion[] = [...cuenta.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .map((e) => ({ ...e, pct: redondeo((e.n / base) * 100) }))
  return { base, items }
}

const PALABRAS_VACIAS = new Set(
  'a al algo con de del el en es la las lo los me mi mis muy no para por que se si su sus te tu un una y o ya lo mas pero como cuando donde este esta esto'.split(
    ' '
  )
)

/**
 * Frases literales que más se repiten en texto libre (bigramas y trigramas sin palabras vacías en
 * los extremos). Cuenta cuántas PERSONAS la usan, no cuántas veces: una respuesta larga no pesa más.
 * `minPersonas` evita presentar una coincidencia casual como patrón.
 */
export function frasesRepetidas(textos: (string | null | undefined)[], minPersonas = 3, max = 8) {
  const porFrase = new Map<string, number>()
  let base = 0
  for (const t of textos) {
    if (!t || !t.trim()) continue
    base += 1
    const palabras = norm(t)
      .replace(/[^a-z0-9ñ ]/g, ' ')
      .split(' ')
      .filter(Boolean)
    const vistas = new Set<string>()
    for (const n of [2, 3]) {
      for (let i = 0; i + n <= palabras.length; i++) {
        const tramo = palabras.slice(i, i + n)
        if (PALABRAS_VACIAS.has(tramo[0]) || PALABRAS_VACIAS.has(tramo[n - 1])) continue
        vistas.add(tramo.join(' '))
      }
    }
    for (const f of vistas) porFrase.set(f, (porFrase.get(f) ?? 0) + 1)
  }
  const items = [...porFrase.entries()]
    .filter(([, n]) => n >= minPersonas)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
  // Si «ganar dinero online» ya aparece, «ganar dinero» solo repite lo mismo: se queda la más larga.
  const finales: { frase: string; personas: number }[] = []
  for (const [frase, personas] of items) {
    if (finales.some((f) => f.frase.includes(frase) && f.personas >= personas)) continue
    finales.push({ frase, personas })
    if (finales.length >= max) break
  }
  return { base, items: finales.map((f) => ({ ...f, pct: redondeo((f.personas / base) * 100) })) }
}

// ── Datos que faltan ───────────────────────────────────────────────────────────

export type FuentesLanzamiento = {
  /** Cruzado en este informe (cuando hay citas leídas de la base). */
  agendas: boolean
  ventas: boolean
  /** Integración configurada en la subcuenta. */
  meta: boolean
  tiktokAds: boolean
  googleAds: boolean
  nutricionEmail: boolean
  nutricionWhatsapp: boolean
  asistenciaEvento: boolean
  /** Hay leads con creativo de origen (utm_content) guardado. */
  creativoOrigen: boolean
  /** Hay respuestas de encuesta con las que medir calidad. */
  encuesta: boolean
}

export type DatoFaltante = { id: string; mensaje: string; solucion: string }

export function datosQueFaltan(f: FuentesLanzamiento): DatoFaltante[] {
  const out: DatoFaltante[] = []
  const falta = (cond: boolean, id: string, mensaje: string, solucion: string) => {
    if (!cond) out.push({ id, mensaje, solucion })
  }
  falta(
    f.creativoOrigen,
    'creativo',
    'Ningún lead guarda el anuncio de origen: no se puede decir qué anuncio escalar o apagar.',
    'Añade utm_content a los anuncios y asegúrate de que el formulario del lanzamiento lo envía.'
  )
  falta(
    f.encuesta,
    'encuesta',
    'Nadie ha contestado la encuesta del registro: no hay calidad de lead que medir.',
    'Incluye las preguntas de ingresos, objetivo y frenos en el formulario del lanzamiento.'
  )
  falta(
    f.meta,
    'meta',
    'Meta Ads no está conectado: no hay gasto ni coste por registro.',
    'Conecta Meta en Ajustes → Integraciones y selecciona la cuenta publicitaria.'
  )
  falta(
    f.tiktokAds,
    'tiktok_ads',
    'TikTok Ads sin datos de anuncios.',
    'Conecta la cuenta publicitaria de TikTok cuando esté disponible en Integraciones.'
  )
  falta(
    f.googleAds,
    'google_ads',
    'Google Ads sin datos de anuncios.',
    'Aún no hay integración de Google Ads: el gasto se carga a mano o no se mide.'
  )
  falta(
    f.nutricionEmail,
    'nutricion_email',
    'Sin aperturas ni clics de la secuencia de emails.',
    'Conecta la herramienta de email (o envía sus eventos por webhook) para medir open rate y click rate.'
  )
  falta(
    f.nutricionWhatsapp,
    'nutricion_whatsapp',
    'Sin respuestas ni lecturas de la nutrición por WhatsApp.',
    'Requiere la bandeja de conversaciones de GHL (eventos de mensajes).'
  )
  falta(
    f.asistenciaEvento,
    'asistencia_evento',
    'Sin asistencia real al directo (Zoom, Meet o plataforma de webinar).',
    'Importa el listado de asistentes del directo o conecta la plataforma; hoy solo se cuenta «confirmó».'
  )
  falta(
    f.agendas,
    'agendas',
    'Agendas no cruzadas con este lanzamiento.',
    'Conecta Calendly o GHL para que las citas queden vinculadas al contacto.'
  )
  falta(
    f.ventas,
    'ventas',
    'Ventas no cruzadas con este lanzamiento.',
    'Conecta tu pasarela de pago (Stripe, Sequra, Hotmart…) para vincular ventas al contacto.'
  )
  return out
}

// ── Acciones ───────────────────────────────────────────────────────────────────

export type Accion = { area: 'anuncios' | 'embudo' | 'audiencia' | 'datos'; texto: string; dato: string }

export function construirAcciones(p: {
  anuncios: { anuncio: string; veredicto: Veredicto; totalLeads: number; pctBuenos: number }[]
  embudo: PasoEmbudo[]
  frenos: { base: number; items: ItemDistribucion[] }
  faltan: DatoFaltante[]
}): Accion[] {
  const acciones: Accion[] = []
  for (const a of p.anuncios) {
    if (a.veredicto === 'escalar')
      acciones.push({
        area: 'anuncios',
        texto: `Subir presupuesto a «${a.anuncio}».`,
        dato: `${a.totalLeads} leads, ${a.pctBuenos}% buenos, por encima de la media del lanzamiento.`,
      })
    if (a.veredicto === 'apagar')
      acciones.push({
        area: 'anuncios',
        texto: `Revisar o apagar «${a.anuncio}».`,
        dato: `${a.totalLeads} leads, ${a.pctBuenos}% buenos, por debajo de la media del lanzamiento.`,
      })
  }
  const conf = p.embudo.find((x) => x.id === 'confirmados')
  if (conf && conf.pctSobreRegistrados !== null && conf.pctSobreRegistrados < 50)
    acciones.push({
      area: 'embudo',
      texto: 'Reforzar la confirmación del día anterior: menos de la mitad confirma.',
      dato: `${conf.n} de ${p.embudo[0].n} registrados confirmaron (${conf.pctSobreRegistrados}%).`,
    })
  const top = p.frenos.items[0]
  if (top && p.frenos.base >= 10 && top.pct >= 25)
    acciones.push({
      area: 'audiencia',
      texto: `Tratar este freno desde el principio del directo y en el grupo: «${top.texto}».`,
      dato: `${top.n} de ${p.frenos.base} respuestas (${top.pct}%).`,
    })
  for (const f of p.faltan.slice(0, 3)) acciones.push({ area: 'datos', texto: f.solucion, dato: f.mensaje })
  return acciones
}
