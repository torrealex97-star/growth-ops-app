// Calidad de lead del lanzamiento — puerto del scoring de iawinners (lib/launch/quality.ts).
//
// Diferencia con el origen: la fuente aquí también es `contacts.qualification` (JSON en Postgres),
// pero este fichero es núcleo PURO: no toca base de datos, así que los tests lo ejercitan sin
// Supabase. Las respuestas se resuelven por el TEXTO de la pregunta sobre
// `qualification.respuestas`, no por las claves de `lib/contacts/cualificacion.ts`. Es a propósito:
// ese mapeo lo comparten el webhook de Calendly y el reagendado, y tocarlo para añadir las preguntas
// del lanzamiento arriesgaba romperlos. Aquí solo leemos, así que resolver por texto es más tolerante
// a que en GHL reformulen una pregunta.

export type Respuesta = { q: string; a: string }
export type Qualification = { respuestas?: Respuesta[]; [k: string]: unknown }

// ── Resolución de respuestas por texto de pregunta ───────────────────────────

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** Campos de la encuesta que nos interesan, con los patrones de pregunta que los identifican. */
const FIELD_PATTERNS: Record<string, RegExp> = {
  // "¿Tienes independencia económica?" → respuesta tipo "Sí, tengo independencia"
  independencia: /independencia|independiente economicamente/,
  // Lo que gana AHORA. Ojo al orden: se comprueba antes que `objetivo` no, sino al revés (ver resolve).
  salario: /salario|estas ganando|ganas actualmente|ingresos actuales|cuanto estas generando|generando al mes/,
  // Lo que QUIERE ganar. Incluye la redacción larga del formulario ("¿Cuánto necesitas ganar al mes
  // para sentirte tranquilo?") y la etiqueta corta de GHL ("Ganar al mes").
  objetivo:
    /objetivo mensual|quieres ganar|te gustaria ganar|meta mensual|cuanto quieres facturar|necesitas ganar|sentirte tranquilo|^ganar al mes/,
  relacion_ia: /relacion (actual )?con la ia|nivel con la ia|usas la ia|conocimiento de ia/,
  frenos: /fren[ao]|que te impide|que te detiene|obstaculo|te esta parando/,
  ocupacion: /ocupacion|a que te dedicas|situacion laboral|estudiante|emprend/,
  edad: /\bedad\b|cuantos anos/,
  asistencia: /asistir|asistencia|vas a estar|podras conectarte/,
  // Pregunta abierta: "¿Qué tendría que pasar al final del evento para que haya merecido la pena?"
  que_piden: /tendria que pasar|merecido la pena/,
}

// `objetivo` se resuelve ANTES que `salario`: "¿cuánto quieres ganar al mes?" contiene "ganar" y
// podría colarse en el patrón de salario si se evaluase primero.
const RESOLVE_ORDER = [
  'independencia',
  'objetivo',
  'salario',
  'relacion_ia',
  'frenos',
  'ocupacion',
  'edad',
  'que_piden',
  'asistencia',
] as const

/** Extrae los campos de interés de una `qualification`, resolviendo por texto de pregunta. */
export function resolveFields(q: Qualification | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!q) return out

  const pairs: Respuesta[] = Array.isArray(q.respuestas) ? q.respuestas : []
  const taken = new Set<string>()

  for (const field of RESOLVE_ORDER) {
    const re = FIELD_PATTERNS[field]
    for (const { q: question, a } of pairs) {
      const key = question + '||' + a
      if (taken.has(key)) continue
      if (re.test(norm(question)) && a?.trim()) {
        out[field] = a.trim()
        taken.add(key)
        break
      }
    }
  }

  // Respaldo: si el webhook ya guardó una clave mapeada y no la hemos resuelto por texto, la usamos.
  const fallback: Record<string, string> = {
    salario: 'ingresos',
    ocupacion: 'situacion',
    asistencia: 'confirma_asistencia',
  }
  for (const [field, legacyKey] of Object.entries(fallback)) {
    if (!out[field] && typeof q[legacyKey] === 'string' && (q[legacyKey] as string).trim()) {
      out[field] = (q[legacyKey] as string).trim()
    }
  }
  if (!out.edad && typeof q.edad === 'string' && q.edad.trim()) out.edad = q.edad.trim()

  return out
}

// ── Scoring ──────────────────────────────────────────────────────────────────
//
// Hay DOS criterios y se enseñan los dos, para poder comparar:
//
// · `qualityScoreJunio` — el del lanzamiento de junio, sin tocar. Independencia +4, salario hasta
//   +6 en escalera (cuanto más gana, mejor) y objetivo hasta +3. Da por hecho que ganar más = mejor
//   lead, y el 80 % de los leads españoles gana menos de 2.000 €, así que puntuaba bajo a casi todos.
//
// · `qualityScore` (v2) — recalibrado con los cierres reales del evergreen (385 leads con cita, 42
//   ventas). Cita→venta por ingresos: <500 € 7,8 % · 500-1k 16,7 % · 1-2k 13,2 % · 2-3k 11,1 % ·
//   3-5k 7,7 % · >5k 9,3 %. Por edad: 25-34 19 % · 55-64 21 % · 35-54 ≈ 6,5 %. O sea: el salario
//   alto NO predice la compra (la franja 500-2k cierra mejor que la de >3k) y la edad sí
//   discrimina. De ahí los pesos:
//
//     Independencia económica  hasta 3   Sí = 3 · depende de la pareja = 1 · de los padres = 0
//     Ingresos actuales        hasta 2   curva, no escalera: 1-5k = 2 · <1k y >5k = 1
//     Ambición (gap)           hasta 2   cuántos tramos por encima de lo que gana quiere ganar
//     Edad                     hasta 2   26-35 = 2 · >50 = 1,5 · resto = 0,5
//     Relación con la IA       hasta 1   empieza o uso básico = 1 · ya factura con IA = 0
//                              ───────
//                              10
//
// Muestra pequeña (42 ventas): los pesos se revisan cuando el lanzamiento tenga ventas propias.

/** ¿Respuesta afirmativa? La negación se comprueba primero: "No, todavía no tengo independencia"
 *  contiene "tengo independencia" y si no se descarta antes puntuaría como un sí. */
function isAfirmativo(v: string): boolean {
  const s = norm(v || '').trim()
  if (!s) return false
  if (/^no\b|^todavia no|^aun no|^ahora no|^de momento no/.test(s)) return false
  return /^si\b|^si,|^claro|^por supuesto|tengo independencia|soy independiente/.test(s)
}

export function tieneIndependencia(v: string): boolean {
  return isAfirmativo(v)
}

/** Tramo de dinero al mes: 0 <1k · 1 1-2k · 2 2-5k · 3 5-10k · 4 >10k. null si no se reconoce. */
export function tramoDinero(v: string): number | null {
  // El formulario del evergreen (algunos leads entran por ahí) escribe "€1k y €2k": se pasa a miles.
  const s = (v || '').replace(/€/g, '').replace(/(\d+)\s*k\b/gi, '$1.000')
  if (!s.trim()) return null
  if (/m[áa]s de 10[.,]?000/i.test(s)) return 4
  if (/5[.,]?000.*10[.,]?000/.test(s)) return 3
  if (/m[áa]s de 5[.,]?000/i.test(s)) return 3
  if (/[23][.,]?000.*[35][.,]?000/.test(s)) return 2
  if (/1[.,]?000.*2[.,]?000/.test(s)) return 1
  if (/menos de 1[.,]?000|menos de 500|500 y 1[.,]?000/i.test(s)) return 0
  return null
}

// Criterio de junio (se conserva tal cual para la comparativa).
export function scoreIndependencia(v: string): number {
  return isAfirmativo(v) ? 4 : 0
}

export function scoreSalario(v: string): number {
  return [0, 1, 3, 5, 6][tramoDinero(v) ?? 0]
}

export function scoreObjetivo(v: string): number {
  const t = tramoDinero(v)
  return t === null ? 0 : [0, 0, 1, 2, 3][t]
}

export const MAX_RAW_SCORE = 13

/** Calidad 0-10 con el criterio del lanzamiento de junio. */
export function qualityScoreJunio(fields: Record<string, string>): number | null {
  const { independencia, salario, objetivo } = fields
  if (!independencia && !salario && !objetivo) return null
  const raw = scoreIndependencia(independencia) + scoreSalario(salario) + scoreObjetivo(objetivo)
  return Math.round((raw / MAX_RAW_SCORE) * 10 * 10) / 10
}

// Criterio v2 — cada pieza por separado para poder explicar la nota.

export function v2Independencia(v: string): number {
  if (!v) return 0
  if (isAfirmativo(v)) return 3
  return /pareja/.test(norm(v)) ? 1 : 0
}

export function v2Ingresos(v: string): number {
  const t = tramoDinero(v)
  if (t === null) return 0
  return t === 1 || t === 2 ? 2 : 1
}

export function v2Ambicion(salario: string, objetivo: string): number {
  const s = tramoDinero(salario)
  const o = tramoDinero(objetivo)
  if (s === null || o === null) return 0
  const gap = o - s
  return gap >= 2 ? 2 : gap === 1 ? 1 : 0
}

/** Edad aproximada en años a partir del rango de la encuesta (punto medio). null si no se reconoce. */
export function edadAprox(v: string): number | null {
  const s = norm(v || '')
  if (!s.trim()) return null
  // Tramos abiertos ("Menos de 25", "Más de 50", "Más de 60"…): un punto razonable fuera del tope.
  const under = s.match(/menos de (\d{2})/)
  if (under) return Number(under[1]) - 3
  const over = s.match(/mas de (\d{2})/)
  if (over) return Number(over[1]) + 5
  const m = s.match(/(\d{2})\D+(\d{2})/)
  if (m) return Math.round((Number(m[1]) + Number(m[2])) / 2)
  return null
}

export function v2Edad(v: string): number {
  const e = edadAprox(v)
  if (e === null) return 0
  if (e >= 26 && e <= 35) return 2
  if (e > 50) return 1.5
  return 0.5
}

export function v2RelacionIA(v: string): number {
  const s = norm(v || '')
  if (!s.trim()) return 0
  if (/generando ingresos|he generado/.test(s)) return 0
  if (/agencia ia casi lista|automatizaciones|chat ?bots/.test(s)) return 0.5
  return 1
}

export type DesgloseCalidad = {
  independencia: number
  ingresos: number
  ambicion: number
  edad: number
  relacionIA: number
}

export function desgloseCalidad(f: Record<string, string>): DesgloseCalidad {
  return {
    independencia: v2Independencia(f.independencia),
    ingresos: v2Ingresos(f.salario),
    ambicion: v2Ambicion(f.salario, f.objetivo),
    edad: v2Edad(f.edad),
    relacionIA: v2RelacionIA(f.relacion_ia),
  }
}

/** Calidad 0-10 de un lead (criterio v2). Devuelve null si no contestó ninguna pregunta que puntúa. */
export function qualityScore(fields: Record<string, string>): number | null {
  const { independencia, salario, objetivo, edad, relacion_ia } = fields
  if (!independencia && !salario && !objetivo && !edad && !relacion_ia) return null
  const d = desgloseCalidad(fields)
  const raw = d.independencia + d.ingresos + d.ambicion + d.edad + d.relacionIA
  return Math.round(raw * 10) / 10
}

/** A partir de qué nota un lead cuenta como "bueno" en los recuentos. */
export const UMBRAL_LEAD_BUENO = 8

// ── Qué piden (pregunta abierta) ─────────────────────────────────────────────
// Temas por palabras clave, deterministas: la misma respuesta cae siempre en el mismo tema y el
// panel y la IA cuentan lo mismo. Una respuesta puede tener varios temas.

export const TEMAS_PIDEN: { id: string; label: string; re: RegExp }[] = [
  {
    id: 'confianza',
    label: 'Que sea real, no un vendehumos',
    re: /vende ?humo|humo|\breal\b|realmente sea|verdad|estafa|fiar|fiable|confianza|conven[cz]|garant|engan|genuin|no (me )?(quiera|intente)n? vender|otro curso|creible|mas de lo mismo|biografia|no explican/,
  },
  {
    id: 'clientes',
    label: 'Saber conseguir clientes y vender',
    re: /client|vender|venta|captar|captacion|nicho|comercializ|facturar|mercado/,
  },
  {
    id: 'paso_a_paso',
    label: 'Un paso a paso práctico y claro',
    re: /paso a paso|practic|claro|clara|claridad|hoja de ruta|plan\b|metodo|estructura|workflow|guia|ejemplo|caso|como hacerlo|sencill|facil/,
  },
  {
    id: 'crear_agentes',
    label: 'Aprender a crear agentes y usar las herramientas',
    re: /crear|agente|herramienta|automatiz|montar (la|una|mi)? ?(agencia|agente)|aprender a (crear|hacer|usar|montar|manejar)|saber (hacer|usar|crear|montar)|ponerlo en marcha/,
  },
  {
    id: 'dinero',
    label: 'Poder empezar sin dinero / precio bajo',
    re: /no tengo (el )?dinero|sin invertir|invertir|inversion|pagar|gratis|coste|costo|precio|economic|loteria|poca cantidad|sin gastar|entrada de|porcentaje/,
  },
  {
    id: 'capaz',
    label: 'Sentirse capaz y seguro',
    re: /capaz|segur[ao]|preparad|puedo hacerlo|verme|motivaci|empujon|creer que puedo|confianza en mi/,
  },
  {
    id: 'ingresos',
    label: 'Ganar un ingreso / cambiar de vida',
    re: /ganar|ingreso|salario|vivir de|familia|hij[oa]|independencia|extra|rentable|monetiz/,
  },
  {
    id: 'sin_agencia',
    label: 'No quiere montar agencia (uso propio / curiosidad)',
    re: /no quiero (vender|montar)|no tengo interes|automatizar mi negocio|trabajo del dia a dia|agilizar mi trabajo|optimizar tareas|solo (quiero |me interesa )?aprender|curiosidad|no es mi objetivo|no soy un emprendedor/,
  },
  {
    id: 'no_sabe',
    label: 'No sabe / sin respuesta útil',
    re: /^(no ?s[eé]|nose|no lo s[eé]|ya veremos|no lo de|i dont know|aun no estoy seguro|lo sabre despues)\.?$/,
  },
]

/** Temas de una respuesta abierta. Respuestas vacías o basura (".", "X", "A") → no_sabe. */
export function temasDe(texto: string | null | undefined): string[] {
  const s = norm(texto || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.replace(/[^a-z]/g, '').length < 4) return ['no_sabe']
  const out = TEMAS_PIDEN.filter((t) => t.re.test(s)).map((t) => t.id)
  return out.length > 0 ? out : ['otros']
}

// ── Calidad por anuncio ────────────────────────────────────────────────────────────

/** Valores de UTM que no identifican un anuncio concreto (ruido de plataforma). */
export const NOISE_VALS = new Set(['paid', 'social', 'cta-instagram', 'bio-instagram', 'setting', 'app', 'test'])

/** Mínimo de leads para que un anuncio entre en el ranking — con menos, la media no dice nada. */
export const MIN_LEADS_POR_ANUNCIO = 3

/** Por debajo de estas encuestas contestadas, la media de un anuncio se marca como "muestra corta". */
export const MUESTRA_MINIMA = 10

export type LeadForQuality = {
  id: string
  anuncio: string | null
  campana: string | null
  fields: Record<string, string>
  quality: number | null
  qualityJunio: number | null
  citas: number
  ventas: number
  confirmado: boolean
}

export type PublicoResumen = {
  publico: string
  leads: number
  conEncuesta: number
  avgQuality: number
  pctBuenos: number
}

export type AdQuality = {
  /** Nombre del creativo, sin el prefijo del conjunto de anuncios (ADV | RT | …) ni el "- Copia". */
  anuncio: string
  /** Nombres tal cual llegan en utm_content que se han juntado en este creativo. */
  variantes: string[]
  totalLeads: number
  conEncuesta: number
  pctIndependencia: number
  /** Gana 2.000 € o más. Se mantiene como dato, ya no puntúa como "mejor". */
  pctSalarioAlto: number
  pctObjetivoAlto: number
  /** Quiere ganar al menos dos tramos por encima de lo que gana hoy. */
  pctAmbicion: number
  avgQuality: number
  /** Calidad media con el criterio de junio, para comparar. */
  avgQualityJunio: number
  leadsBuenos: number
  pctBuenos: number
  scoreComposite: number
  pctAsisten: number
  edadMedia: number | null
  pct26a35: number
  topFreno: { label: string; pct: number } | null
  topPide: { label: string; pct: number } | null
  citas: number
  ventas: number
  confirmados: number
  publicos: PublicoResumen[]
  /** Por qué queda donde queda, frente a la media del lanzamiento. */
  porQue: string[]
  muestraCorta: boolean
}

export function freq(values: (string | null | undefined)[]): Record<string, number> {
  const map: Record<string, number> = {}
  for (const v of values) if (v && v.trim()) map[v.trim()] = (map[v.trim()] || 0) + 1
  return map
}

export function isRealAd(v: string | null | undefined): boolean {
  if (!v) return false
  const s = v.trim()
  return s.length > 5 && !NOISE_VALS.has(s.toLowerCase())
}

const PREFIJO_CONJUNTO = /^(videos\s+adv|adv|rt\s+bbdd|rt)\s*\|\s*/i

/**
 * El mismo creativo se publica en varios conjuntos (Lookalike, Advantage, Retargeting) y Meta le
 * añade prefijos y "- Copia". Agrupando por el nombre tal cual, "AD 7 SEP" salía partido en cinco
 * filas y el ranking no decía qué creativo gana. Esto devuelve una clave común y un nombre limpio.
 */
export function creativoDe(anuncio: string): { key: string; label: string } {
  let s = anuncio.trim()
  if (/^\d{12,}$/.test(s)) return { key: s, label: `ID Meta …${s.slice(-8)}` }
  for (let i = 0; i < 3; i++) {
    s = s.replace(/\s*-\s*copia(\s*\d+)?\s*$/i, '').replace(PREFIJO_CONJUNTO, '')
  }
  s = s
    .replace(/\s+/g, ' ')
    .replace(/\s*\|\s*/g, ' | ')
    .trim()
  const key = norm(s)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  return { key, label: s }
}

/** Público del conjunto de anuncios, a partir del nombre de la campaña y del prefijo del anuncio. */
export function publicoDe(anuncio: string | null, campana: string | null): string {
  const a = (anuncio || '').trim()
  const c = norm(campana || '')
  if (/^rt\b/i.test(a) || /retarget/.test(c)) return 'Retargeting'
  if (/^(videos\s+)?adv\b/i.test(a) || /advantage/.test(c)) return 'Advantage+'
  if (/lookalike/.test(c)) return 'Lookalike'
  if (/interes/.test(c)) return 'Intereses'
  if (/^\d{12,}$/.test(c)) return 'Campaña sin nombre (ID)'
  return c ? 'Otros' : 'Sin campaña'
}

const media = (xs: number[]) => (xs.length > 0 ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0)
const pctDe = (n: number, total: number) => (total > 0 ? Math.round((n / total) * 100) : 0)

function topDe(values: string[], total: number): { label: string; pct: number } | null {
  const e = Object.entries(freq(values)).sort((a, b) => b[1] - a[1])[0]
  return e ? { label: e[0], pct: pctDe(e[1], total) } : null
}

const labelTema = (id: string) => TEMAS_PIDEN.find((t) => t.id === id)?.label ?? 'Otros'

type Perfil = {
  conEncuesta: number
  avgQuality: number
  pctBuenos: number
  pctIndependencia: number
  pctAmbicion: number
  pct26a35: number
  edadMedia: number | null
}

function perfilDe(ws: LeadForQuality[]): Perfil {
  const edades = ws.map((l) => edadAprox(l.fields.edad)).filter((e): e is number => e !== null)
  return {
    conEncuesta: ws.length,
    avgQuality: media(ws.map((l) => l.quality as number)),
    pctBuenos: pctDe(ws.filter((l) => (l.quality as number) >= UMBRAL_LEAD_BUENO).length, ws.length),
    pctIndependencia: pctDe(ws.filter((l) => tieneIndependencia(l.fields.independencia)).length, ws.length),
    pctAmbicion: pctDe(ws.filter((l) => v2Ambicion(l.fields.salario, l.fields.objetivo) >= 2).length, ws.length),
    pct26a35: pctDe(edades.filter((e) => e >= 26 && e <= 35).length, edades.length),
    edadMedia: edades.length > 0 ? Math.round(edades.reduce((a, b) => a + b, 0) / edades.length) : null,
  }
}

/** Explica en 2-5 frases por qué un anuncio queda por encima o por debajo de la media. */
function explicar(
  a: Perfil & { citas: number; ventas: number; totalLeads: number; topFreno: string | null },
  ref: Perfil,
  topFrenoGlobal: string | null,
  totalConAnuncio: number
): string[] {
  const out: string[] = []
  const cuota = pctDe(a.totalLeads, totalConAnuncio)
  if (cuota >= 15) out.push(`Trae el ${cuota}% de los leads con anuncio identificado: es de los que más volumen mueve.`)
  const signo = (n: number) => (n > 0 ? `+${n}` : `${n}`)
  const dq = Math.round((a.avgQuality - ref.avgQuality) * 10) / 10
  if (Math.abs(dq) >= 0.3) out.push(`Calidad ${a.avgQuality}/10, ${signo(dq)} frente a la media (${ref.avgQuality}).`)
  else out.push(`Calidad en la media del lanzamiento (${a.avgQuality}/10).`)
  const comp: [string, number, number][] = [
    [`leads buenos (≥${UMBRAL_LEAD_BUENO})`, a.pctBuenos, ref.pctBuenos],
    ['con independencia económica', a.pctIndependencia, ref.pctIndependencia],
    ['de 26 a 35 años (el tramo que más cierra)', a.pct26a35, ref.pct26a35],
    ['con mucha ambición (quieren 2+ tramos más de lo que ganan)', a.pctAmbicion, ref.pctAmbicion],
  ]
  for (const [txt, v, r] of comp.sort((x, y) => Math.abs(y[1] - y[2]) - Math.abs(x[1] - x[2]))) {
    if (Math.abs(v - r) >= 8) out.push(`${v}% ${txt}, ${v > r ? 'más' : 'menos'} que la media (${r}%).`)
  }
  if (a.topFreno && topFrenoGlobal && a.topFreno !== topFrenoGlobal)
    out.push(`Su freno principal es distinto al del resto: "${a.topFreno}".`)
  if (a.ventas > 0 || a.citas > 0)
    out.push(
      `Ya ha generado ${a.citas} cita${a.citas === 1 ? '' : 's'} y ${a.ventas} venta${a.ventas === 1 ? '' : 's'}.`
    )
  if (a.conEncuesta < MUESTRA_MINIMA)
    out.push(`Ojo: solo ${a.conEncuesta} encuestas contestadas, la media todavía puede moverse mucho.`)
  return out.slice(0, 6)
}

/** Calidad agregada por público (Lookalike, Advantage+, Retargeting…). */
export function computePorPublico(leads: LeadForQuality[]): PublicoResumen[] {
  const by = new Map<string, LeadForQuality[]>()
  for (const l of leads) {
    if (!isRealAd(l.anuncio) && !l.campana) continue
    const k = publicoDe(l.anuncio, l.campana)
    if (!by.has(k)) by.set(k, [])
    by.get(k)!.push(l)
  }
  return [...by.entries()]
    .map(([publico, g]) => {
      const ws = g.filter((l) => l.quality !== null)
      return {
        publico,
        leads: g.length,
        conEncuesta: ws.length,
        avgQuality: media(ws.map((l) => l.quality as number)),
        pctBuenos: pctDe(ws.filter((l) => (l.quality as number) >= UMBRAL_LEAD_BUENO).length, ws.length),
      }
    })
    .sort((a, b) => b.leads - a.leads)
}

/**
 * Ranking de creativos por calidad de lead que traen.
 * `scoreComposite = volumen × calidad media` — premia al anuncio que trae muchos Y buenos, que es
 * la decisión real de dónde meter presupuesto. El volumen es de todos sus conjuntos juntos.
 */
export function computeAdQuality(leads: LeadForQuality[]): AdQuality[] {
  const byAd = new Map<string, { labels: Record<string, number>; variantes: Set<string>; group: LeadForQuality[] }>()
  for (const l of leads) {
    if (!isRealAd(l.anuncio)) continue
    const { key, label } = creativoDe(l.anuncio!)
    if (!byAd.has(key)) byAd.set(key, { labels: {}, variantes: new Set(), group: [] })
    const e = byAd.get(key)!
    e.labels[label] = (e.labels[label] || 0) + 1
    e.variantes.add(l.anuncio!.trim())
    e.group.push(l)
  }

  const todosWs = leads.filter((l) => l.quality !== null)
  const ref = perfilDe(todosWs)
  const topFrenoGlobal =
    topDe(
      todosWs.map((l) => l.fields.frenos),
      todosWs.length
    )?.label ?? null
  const totalConAnuncio = leads.filter((l) => isRealAd(l.anuncio)).length

  const out: AdQuality[] = []
  for (const { labels, variantes, group } of byAd.values()) {
    if (group.length < MIN_LEADS_POR_ANUNCIO) continue
    const anuncio = Object.entries(labels).sort((a, b) => b[1] - a[1])[0][0]
    const withSurvey = group.filter((l) => l.quality !== null)
    const p = perfilDe(withSurvey)
    const pct = (n: number) => pctDe(n, withSurvey.length)

    const conAsistencia = group.filter((l) => l.fields.asistencia)
    const asisten = conAsistencia.filter(
      (l) => isAfirmativo(l.fields.asistencia) || /asistir[ée]|asisto/.test(norm(l.fields.asistencia))
    ).length
    const topFreno = topDe(
      withSurvey.map((l) => l.fields.frenos),
      withSurvey.length
    )
    const temas = group
      .filter((l) => l.fields.que_piden)
      .flatMap((l) => temasDe(l.fields.que_piden))
      .filter((t) => t !== 'no_sabe' && t !== 'otros')
    const nPiden = group.filter((l) => l.fields.que_piden).length
    const tp = topDe(temas, nPiden)
    const citas = group.filter((l) => l.citas > 0).length
    const ventas = group.filter((l) => l.ventas > 0).length

    out.push({
      anuncio,
      variantes: [...variantes].sort(),
      totalLeads: group.length,
      conEncuesta: withSurvey.length,
      pctIndependencia: p.pctIndependencia,
      pctSalarioAlto: pct(withSurvey.filter((l) => (tramoDinero(l.fields.salario) ?? 0) >= 2).length),
      pctObjetivoAlto: pct(withSurvey.filter((l) => (tramoDinero(l.fields.objetivo) ?? 0) >= 3).length),
      pctAmbicion: p.pctAmbicion,
      avgQuality: p.avgQuality,
      avgQualityJunio: media(withSurvey.map((l) => l.qualityJunio ?? 0)),
      leadsBuenos: withSurvey.filter((l) => (l.quality as number) >= UMBRAL_LEAD_BUENO).length,
      pctBuenos: p.pctBuenos,
      scoreComposite: Math.round(group.length * p.avgQuality * 10) / 10,
      pctAsisten: conAsistencia.length > 0 ? Math.round((asisten / conAsistencia.length) * 100) : 0,
      edadMedia: p.edadMedia,
      pct26a35: p.pct26a35,
      topFreno,
      topPide: tp ? { label: labelTema(tp.label), pct: tp.pct } : null,
      citas,
      ventas,
      confirmados: group.filter((l) => l.confirmado).length,
      publicos: computePorPublico(group),
      porQue: explicar(
        { ...p, citas, ventas, totalLeads: group.length, topFreno: topFreno?.label ?? null },
        ref,
        topFrenoGlobal,
        totalConAnuncio
      ),
      muestraCorta: withSurvey.length < MUESTRA_MINIMA,
    })
  }

  return out.sort((a, b) => b.scoreComposite - a.scoreComposite)
}
