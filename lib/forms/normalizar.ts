// SANEAR UNA CONFIG QUE NO HA ESCRITO UNA PERSONA EN EL CONSTRUCTOR (pura).
//
// La generan la IA («crear con IA») y los importadores (Typeform, Calendly, GoHighLevel). Ninguna de esas
// fuentes garantiza una config válida: ids con espacios o repetidos, tipos que no existen aquí, opciones
// vacías, saltos a preguntas que no están… Esto la deja en algo que SIEMPRE pasa `formConfigSchema` o falla
// diciendo por qué, y anota en `avisos` lo que tuvo que cambiar para que nadie crea que se importó entero.
//
// No añade nada que la fuente no dijera, salvo lo imprescindible: una bienvenida, un final por defecto y el
// rol semántico de email/teléfono (es lo que enlaza la respuesta con el contacto).

import { formConfigSchema } from './schema'
import {
  FIELD_TYPES,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  type Condition,
  type ConditionGroup,
  type Ending,
  type FieldType,
  type FormConfig,
  type LogicRule,
  type Question,
  type QuestionOption,
  type ScoringWeight,
} from './types'
import { validateConfig } from './validation'

type Json = Record<string, unknown>
const esObjeto = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const txt = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Identificador válido para el esquema (`[a-zA-Z0-9_-]{1,40}`), legible, sin acentos. */
export function idSeguro(valor: unknown, respaldo: string): string {
  const s = String(typeof valor === 'string' || typeof valor === 'number' ? valor : '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return s || respaldo
}

function unico(base: string, usados: Set<string>): string {
  let id = base
  for (let i = 2; usados.has(id); i++) id = `${base.slice(0, 40 - String(i).length - 1)}-${i}`
  usados.add(id)
  return id
}

// Nombres que usan otras herramientas (y la IA cuando se despista) → tipo de aquí.
const ALIAS_TIPO: Record<string, FieldType> = {
  text: 'shortText',
  short_text: 'shortText',
  string: 'shortText',
  textarea: 'longText',
  long_text: 'longText',
  paragraph: 'longText',
  tel: 'phone',
  phone_number: 'phone',
  website: 'url',
  link: 'url',
  radio: 'singleChoice',
  single_select: 'singleChoice',
  multiple_choice: 'singleChoice',
  select: 'dropdown',
  checkbox: 'multiChoice',
  checkboxes: 'multiChoice',
  multi_select: 'multiChoice',
  boolean: 'yesNo',
  yes_no: 'yesNo',
  opinion_scale: 'scale',
  stars: 'rating',
  legal: 'consent',
  terms: 'consent',
}
const CON_OPCIONES: readonly FieldType[] = ['singleChoice', 'multiChoice', 'dropdown']
const SEMANTICA = /^(contact\.(name|email|phone)|rating|nps|teacher|module|class|qualification\.[a-z0-9_]{1,40})$/
const OPERADORES = ['equals', 'notEquals', 'in', 'notIn', 'contains', 'gt', 'gte', 'lt', 'lte', 'isAnswered', 'isEmpty']
const esHttps = (v: unknown): v is string => typeof v === 'string' && /^https:\/\/\S+$/.test(v) && v.length <= 2000

function tipoDe(v: unknown): FieldType | null {
  if (typeof v !== 'string') return null
  if ((FIELD_TYPES as readonly string[]).includes(v)) return v as FieldType
  return ALIAS_TIPO[v.toLowerCase()] ?? null
}

function opcionesDe(v: unknown): QuestionOption[] {
  if (!Array.isArray(v)) return []
  const usados = new Set<string>()
  const out: QuestionOption[] = []
  for (const o of v.slice(0, MAX_OPTIONS)) {
    const label = txt(esObjeto(o) ? (o.label ?? o.value) : o, 200)
    if (!label) continue
    // El valor se conserva tal cual si viene (lo referencian reglas y puntuación); si no, sale de la etiqueta.
    const propio = esObjeto(o) ? txt(o.value, 120) : ''
    const value = propio && !usados.has(propio) ? propio : unico(idSeguro(label, `opcion-${out.length + 1}`), usados)
    usados.add(value)
    out.push({ value, label })
  }
  return out
}

function escalar(v: unknown): v is string | number | boolean {
  return (typeof v === 'string' && v.length <= 300) || typeof v === 'number' || typeof v === 'boolean'
}

function grupoDe(v: unknown, existe: (id: string) => boolean): ConditionGroup | undefined {
  if (!esObjeto(v) || !Array.isArray(v.conditions)) return undefined
  const conditions: Condition[] = []
  for (const c of v.conditions.slice(0, 20)) {
    if (!esObjeto(c) || typeof c.questionId !== 'string' || !OPERADORES.includes(String(c.op))) continue
    if (!c.questionId.startsWith('$') && !existe(c.questionId)) continue
    const valor = Array.isArray(c.value) ? c.value.filter(escalar).slice(0, 50) : escalar(c.value) ? c.value : undefined
    conditions.push({
      questionId: c.questionId,
      op: c.op as Condition['op'],
      ...(valor !== undefined ? { value: valor } : {}),
    })
  }
  return conditions.length ? { match: v.match === 'any' ? 'any' : 'all', conditions } : undefined
}

export interface ConfigSaneada {
  config: FormConfig
  /** Lo que se cambió o descartó para que la config fuera válida. Se enseña a quien crea el formulario. */
  avisos: string[]
}

/**
 * Devuelve una config válida a partir de un objeto de origen no fiable. Lanza si no hay forma de sacar un
 * formulario de ahí (sin preguntas, o algo que el esquema sigue rechazando), con el motivo en el mensaje.
 */
export function sanearConfig(crudo: unknown): ConfigSaneada {
  if (!esObjeto(crudo)) throw new Error('La configuración del formulario no es un objeto.')
  const avisos: string[] = []
  const usados = new Set<string>()
  // id de origen → id final, para reescribir reglas y condiciones que apuntaban al antiguo.
  const mapa = new Map<string, string>()

  const preguntas: Question[] = []
  const pendientes: { q: Question; showIf: unknown }[] = []
  const origen = Array.isArray(crudo.questions) ? crudo.questions : []
  if (origen.length > MAX_QUESTIONS) avisos.push(`Se han importado las primeras ${MAX_QUESTIONS} preguntas.`)
  for (const item of origen.slice(0, MAX_QUESTIONS)) {
    if (!esObjeto(item)) continue
    let type = tipoDe(item.type)
    const title = txt(item.title, 500)
    if (!type) {
      avisos.push(
        `«${title || String(item.type)}»: el tipo «${String(item.type)}» no existe aquí; queda como texto corto.`
      )
      type = 'shortText'
    }
    if (!title && type !== 'hidden') continue
    const id = unico(idSeguro(item.id, idSeguro(title, `pregunta-${preguntas.length + 1}`)), usados)
    // Si dos preguntas traían el mismo id, las referencias apuntan a la PRIMERA.
    if (typeof item.id === 'string' && !mapa.has(item.id)) mapa.set(item.id, id)

    const q: Question = { id, type, title }
    const help = txt(item.help, 1000)
    if (help) q.help = help
    if (item.required === true) q.required = true
    const placeholder = txt(item.placeholder, 200)
    if (placeholder) q.placeholder = placeholder
    if (esHttps(item.imageUrl)) q.imageUrl = item.imageUrl

    if (CON_OPCIONES.includes(type)) {
      const options = opcionesDe(item.options)
      if (options.length < 2) {
        avisos.push(`«${title}» no traía al menos dos opciones; queda como texto corto.`)
        q.type = 'shortText'
      } else {
        q.options = options
        if (item.allowOther === true) q.allowOther = true
      }
    }
    if (type === 'multiChoice' || type === 'number') {
      const min = num(item.min)
      const max = num(item.max)
      if (min !== undefined) q.min = min
      if (max !== undefined && (min === undefined || max >= min)) q.max = max
    }
    if (type === 'rating' || type === 'scale') {
      const tope = num(item.scaleMax)
      if (tope !== undefined) q.scaleMax = Math.min(10, Math.max(2, Math.round(tope)))
    }
    if (type === 'scale' || type === 'nps') {
      const l = esObjeto(item.scaleLabels) ? item.scaleLabels : null
      const min = txt(l?.min, 60)
      const max = txt(l?.max, 60)
      if (min || max) q.scaleLabels = { ...(min ? { min } : {}), ...(max ? { max } : {}) }
    }
    if (type === 'hidden') {
      const clave = idSeguro(item.hiddenKey ?? item.id, '').replace(/-/g, '_')
      if (!clave) continue
      q.hiddenKey = clave
    }
    if (type === 'hidden' || type === 'booking') {
      const d = txt(item.defaultValue, 500)
      if (d && (type === 'hidden' || esHttps(d))) q.defaultValue = d
    }
    if (typeof item.semantic === 'string' && SEMANTICA.test(item.semantic)) q.semantic = item.semantic as never
    preguntas.push(q)
    pendientes.push({ q, showIf: item.showIf })
  }

  // El email y el teléfono enlazan la respuesta con el contacto: si nadie lo marcó, se marca el primero.
  for (const [tipo, rol] of [
    ['email', 'contact.email'],
    ['phone', 'contact.phone'],
  ] as const) {
    if (preguntas.some((q) => q.semantic === rol)) continue
    const primera = preguntas.find((q) => q.type === tipo && !q.semantic)
    if (primera) primera.semantic = rol
  }
  // Un mismo rol de contacto en dos preguntas haría que la segunda pisara a la primera.
  for (const rol of ['contact.name', 'contact.email', 'contact.phone'] as const) {
    preguntas
      .filter((q) => q.semantic === rol)
      .slice(1)
      .forEach((q) => delete q.semantic)
  }

  if (!preguntas.some((q) => q.type !== 'hidden' && q.type !== 'statement')) {
    throw new Error('El formulario no tiene ninguna pregunta que se pueda contestar.')
  }

  const final = (id: string) => mapa.get(id) ?? id
  const idsPregunta = new Set(preguntas.map((q) => q.id))
  const existePregunta = (id: string) => idsPregunta.has(final(id))
  const reescribir = (g: ConditionGroup | undefined): ConditionGroup | undefined =>
    g && {
      ...g,
      conditions: g.conditions.map((c) =>
        c.questionId.startsWith('$') ? c : { ...c, questionId: final(c.questionId) }
      ),
    }

  for (const { q, showIf } of pendientes) {
    const g = reescribir(grupoDe(showIf, existePregunta))
    if (g) q.showIf = g
    else if (showIf !== undefined && showIf !== null)
      avisos.push(`«${q.title}»: su condición de visibilidad no era válida y se ha quitado.`)
  }

  const finales: Ending[] = []
  for (const item of Array.isArray(crudo.endings) ? crudo.endings.slice(0, 20) : []) {
    if (!esObjeto(item)) continue
    const title = txt(item.title, 300)
    if (!title) continue
    const id = unico(idSeguro(item.id, `final-${finales.length + 1}`), usados)
    if (typeof item.id === 'string') mapa.set(item.id, id)
    const e: Ending = { id, title }
    const message = txt(item.message, 2000)
    if (message) e.message = message
    const ctaLabel = txt(item.ctaLabel, 80)
    const ctaUrl = txt(item.ctaUrl, 2000)
    if (ctaLabel && /^(https?:\/\/|\{\{)/i.test(ctaUrl)) Object.assign(e, { ctaLabel, ctaUrl })
    const redirectUrl = txt(item.redirectUrl, 2000)
    if (/^(https?:\/\/|\{\{)/i.test(redirectUrl)) {
      e.redirectUrl = redirectUrl
      const ms = num(item.redirectDelayMs)
      if (ms !== undefined) e.redirectDelayMs = Math.min(30000, Math.max(0, Math.round(ms)))
    }
    const cuando = reescribir(grupoDe(item.when, existePregunta))
    if (cuando) e.when = cuando
    finales.push(e)
  }
  if (finales.length === 0) {
    finales.push({ id: unico('gracias', usados), title: 'Gracias', message: 'Hemos recibido tus respuestas.' })
  }
  // Exactamente UN final por defecto: el último sin condición (o el último, si todos la tienen).
  const porDefecto = [...finales].reverse().find((e) => !e.when) ?? finales[finales.length - 1]
  delete porDefecto.when
  for (const e of finales) {
    if (e === porDefecto) e.isDefault = true
    else delete e.isDefault
  }

  const idsFinal = new Set(finales.map((e) => e.id))
  const reglas: LogicRule[] = []
  let descartadas = 0
  for (const item of Array.isArray(crudo.logic) ? crudo.logic.slice(0, 200) : []) {
    const then = esObjeto(item) && esObjeto(item.then) ? item.then : null
    const from = esObjeto(item) && typeof item.from === 'string' ? final(item.from) : ''
    const cuando = esObjeto(item) ? reescribir(grupoDe(item.when, existePregunta)) : undefined
    const salto = then?.type === 'jump' && typeof then.target === 'string' ? final(then.target) : ''
    const fin = then?.type === 'end' && typeof then.endingId === 'string' ? final(then.endingId) : ''
    const destinoOk = salto ? idsPregunta.has(salto) || idsFinal.has(salto) : fin ? idsFinal.has(fin) : false
    if (!idsPregunta.has(from) || !cuando || !destinoOk) {
      descartadas++
      continue
    }
    reglas.push({
      id: unico(`regla-${reglas.length + 1}`, usados),
      from,
      when: cuando,
      then: salto ? { type: 'jump', target: salto } : { type: 'end', endingId: fin },
    })
  }
  if (descartadas) {
    avisos.push(
      descartadas === 1
        ? 'Se ha descartado 1 regla de salto que apuntaba a algo que no existe.'
        : `Se han descartado ${descartadas} reglas de salto que apuntaban a algo que no existe.`
    )
  }

  const w = esObjeto(crudo.welcome) ? crudo.welcome : {}
  const config: FormConfig = {
    schemaVersion: 1,
    welcome: {
      title: txt(w.title, 300) || 'Cuéntanos',
      cta: txt(w.cta, 60) || 'Empezar',
      ...(txt(w.kicker, 80) ? { kicker: txt(w.kicker, 80) } : {}),
      ...(txt(w.subtitle, 600) ? { subtitle: txt(w.subtitle, 600) } : {}),
      ...(txt(w.estimatedTime, 40) ? { estimatedTime: txt(w.estimatedTime, 40) } : {}),
    },
    questions: preguntas,
    logic: reglas,
    endings: finales,
  }

  const s = esObjeto(crudo.scoring) ? crudo.scoring : null
  if (s && s.enabled !== false && Array.isArray(s.weights)) {
    const weights: ScoringWeight[] = []
    for (const p of s.weights.slice(0, 300)) {
      if (!esObjeto(p) || typeof p.questionId !== 'string' || !existePregunta(p.questionId)) continue
      const points = num(p.points)
      if (points === undefined) continue
      const peso: ScoringWeight = { questionId: final(p.questionId), points: Math.min(100, Math.max(-100, points)) }
      if (typeof p.value === 'string' && p.value.length <= 120) peso.value = p.value
      if (Array.isArray(p.in))
        peso.in = p.in.filter((x): x is string => typeof x === 'string' && x.length <= 120).slice(0, 50)
      if (num(p.gte) !== undefined) peso.gte = num(p.gte)
      if (num(p.lte) !== undefined) peso.lte = num(p.lte)
      if (peso.value === undefined && !peso.in?.length && peso.gte === undefined && peso.lte === undefined) continue
      weights.push(peso)
    }
    if (weights.length) {
      const t = esObjeto(s.thresholds) ? s.thresholds : {}
      const acotar = (v: unknown, d: number) => Math.min(100, Math.max(0, num(v) ?? d))
      const caliente = acotar(t.caliente, 70)
      config.scoring = {
        enabled: true,
        weights,
        thresholds: { caliente, templado: Math.min(caliente, acotar(t.templado, 40)) },
        ...(typeof s.tagPrefix === 'string' && /^[a-z0-9_-]{1,40}$/.test(s.tagPrefix)
          ? { tagPrefix: s.tagPrefix }
          : {}),
      }
    }
  }

  const parsed = formConfigSchema.safeParse(config)
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    throw new Error(`La configuración no es válida (${i.path.join('.')}: ${i.message}).`)
  }
  const problemas = validateConfig(config)
  if (problemas.length) throw new Error(`La configuración no es válida: ${problemas.slice(0, 5).join(' ')}`)
  return { config, avisos }
}
