// IMPORTAR UN FORMULARIO DE OTRA HERRAMIENTA (Typeform, Calendly, GoHighLevel).
//
// Lee la definición con la credencial que la subcuenta YA tiene conectada en Ajustes › Integraciones y la
// convierte en una config de aquí, que se guarda como BORRADOR. Solo lectura en el proveedor: no toca nada
// allí. La credencial es la de la SUBCUENTA (`getTenantConfig`, sin relevo a variables globales): nunca se
// lista con el token de otra cuenta.
//
// Lo que cada proveedor deja leer NO es lo mismo, y se dice tal cual en `nota`:
//  · Typeform publica la definición completa: se importan preguntas, opciones, bienvenida y final.
//    La lógica de saltos NO se traduce (su modelo es distinto): se avisa para rehacerla en el constructor.
//  · Calendly: las «preguntas para el invitado» de un tipo de evento + nombre y email (que Calendly pide
//    siempre) + la agenda embebida al final.
//  · GoHighLevel NO publica por API las preguntas de un formulario. Se RECONSTRUYEN: los campos que aparecen
//    en sus últimas respuestas, con el nombre/tipo/opciones del catálogo de campos personalizados. Un
//    formulario sin respuestas no se puede reconstruir, y el orden puede no ser el original.
//
// Todo pasa por `sanearConfig`: lo que no encaja se convierte o se descarta, y queda anotado en `avisos`.

import { baseTypeform, crearClienteTypeform } from '@/lib/typeform/api'
import { sanearConfig } from './normalizar'
import type { FormAudience, FormCategory, FormConfig } from './types'

export const FUENTES = ['typeform', 'calendly', 'ghl'] as const
export type Fuente = (typeof FUENTES)[number]

export const FUENTE_INFO: Record<Fuente, { nombre: string; claves: string[]; elemento: string; nota: string }> = {
  typeform: {
    nombre: 'Typeform',
    claves: ['TYPEFORM_API_TOKEN'],
    elemento: 'formulario',
    nota: 'Se importan las preguntas, sus opciones, la bienvenida y el final. La lógica de saltos no se traduce: revísala en el constructor.',
  },
  calendly: {
    nombre: 'Calendly',
    claves: ['CALENDLY_API_TOKEN'],
    elemento: 'tipo de evento',
    nota: 'Se importan las preguntas para el invitado del tipo de evento, con nombre y email delante y la agenda al final.',
  },
  ghl: {
    nombre: 'GoHighLevel',
    claves: ['GHL_API_TOKEN', 'GHL_LOCATION_ID'],
    elemento: 'formulario',
    nota: 'GoHighLevel no publica las preguntas de un formulario: se reconstruyen a partir de sus últimas respuestas y de tus campos personalizados. Revisa el orden y que no falte ninguna.',
  },
}

export type Cfg = Record<string, string | undefined>
export const fuenteConectada = (fuente: Fuente, cfg: Cfg) => FUENTE_INFO[fuente].claves.every((k) => !!cfg[k]?.trim())

export type ElementoImportable = { id: string; nombre: string; detalle?: string }
export type FormularioImportado = {
  name: string
  category: FormCategory
  audience: FormAudience
  config: FormConfig
  avisos: string[]
}

type Json = Record<string, unknown>
const esObjeto = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const lista = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(esObjeto) : [])
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

// ───────────────────────────── Typeform ─────────────────────────────

const TIPO_TYPEFORM: Record<string, string> = {
  short_text: 'shortText',
  long_text: 'longText',
  email: 'email',
  phone_number: 'phone',
  number: 'number',
  website: 'url',
  date: 'date',
  dropdown: 'dropdown',
  yes_no: 'yesNo',
  rating: 'rating',
  opinion_scale: 'scale',
  nps: 'nps',
  statement: 'statement',
  legal: 'consent',
}
const NO_IMPORTABLE_TYPEFORM: Record<string, string> = {
  file_upload: 'subida de archivos',
  payment: 'pago',
  matrix: 'matriz',
  ranking: 'ranking',
}
const CONTACTO_TYPEFORM: Record<string, { type: string; semantic?: string }> = {
  first_name: { type: 'shortText', semantic: 'contact.name' },
  last_name: { type: 'shortText' },
  email: { type: 'email', semantic: 'contact.email' },
  phone_number: { type: 'phone', semantic: 'contact.phone' },
  company: { type: 'shortText' },
}

/** Typeform deja `{{field:ref}}` (respuestas recordadas) y `*negrita*`/`_cursiva_` en los títulos. */
export function limpiarTituloTypeform(t: unknown): string {
  return str(t)
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:?!])/g, '$1')
    .trim()
}

function campoTypeform(f: Json, avisos: string[]): Json[] {
  const tipo = str(f.type)
  const props = esObjeto(f.properties) ? f.properties : {}
  const title = limpiarTituloTypeform(f.title)
  const required = esObjeto(f.validations) && f.validations.required === true
  const base = { id: str(f.ref) || str(f.id), title, help: limpiarTituloTypeform(props.description), required }

  if (tipo === 'group' || tipo === 'inline_group') return lista(props.fields).flatMap((x) => campoTypeform(x, avisos))
  if (tipo === 'contact_info') {
    return lista(props.fields).map((sub) => {
      const c = CONTACTO_TYPEFORM[str(sub.subfield_key)] ?? { type: 'shortText' }
      return {
        id: str(sub.ref) || str(sub.id),
        title: limpiarTituloTypeform(sub.title),
        required: esObjeto(sub.validations) && sub.validations.required === true,
        ...c,
      }
    })
  }
  if (NO_IMPORTABLE_TYPEFORM[tipo]) {
    avisos.push(`«${title}» es de tipo ${NO_IMPORTABLE_TYPEFORM[tipo]}, que aquí no existe: no se ha importado.`)
    return []
  }
  if (tipo === 'multiple_choice' || tipo === 'picture_choice') {
    return [
      {
        ...base,
        type: props.allow_multiple_selection === true ? 'multiChoice' : 'singleChoice',
        options: lista(props.choices).map((c) => ({ label: str(c.label) })),
        allowOther: props.allow_other_choice === true,
      },
    ]
  }
  if (tipo === 'dropdown') {
    return [{ ...base, type: 'dropdown', options: lista(props.choices).map((c) => ({ label: str(c.label) })) }]
  }
  if (tipo === 'calendly') {
    return [{ ...base, type: 'booking', defaultValue: str(props.url) || str(props.calendly_url) }]
  }
  const nuestro = TIPO_TYPEFORM[tipo]
  if (!nuestro) {
    avisos.push(`«${title}»: el tipo «${tipo}» de Typeform no tiene equivalente; queda como texto corto.`)
    return [{ ...base, type: 'shortText' }]
  }
  const q: Json = { ...base, type: nuestro }
  if (nuestro === 'rating' || nuestro === 'scale') q.scaleMax = Number(props.steps) || undefined
  if (nuestro === 'scale' || nuestro === 'nps') {
    const l = esObjeto(props.labels) ? props.labels : {}
    q.scaleLabels = { min: str(l.left), max: str(l.right) }
  }
  if (nuestro === 'consent') {
    // En un «legal» de Typeform el título ES el texto que se acepta.
    q.placeholder = 'Acepto'
  }
  return [q]
}

export function deTypeform(def: Json): FormularioImportado {
  const avisos: string[] = []
  const questions = lista(def.fields).flatMap((f) => campoTypeform(f, avisos))
  for (const h of Array.isArray(def.hidden) ? def.hidden : []) {
    if (typeof h === 'string' && h) questions.push({ id: h, type: 'hidden', title: h, hiddenKey: h })
  }
  const w = lista(def.welcome_screens)[0]
  const wp = w && esObjeto(w.properties) ? w.properties : {}
  const endings = lista(def.thankyou_screens)
    .filter((t) => str(t.ref) !== 'default_tys' || lista(def.thankyou_screens).length === 1)
    .map((t) => {
      const p = esObjeto(t.properties) ? t.properties : {}
      const url = str(p.redirect_url)
      return {
        id: str(t.ref) || str(t.id),
        title: limpiarTituloTypeform(t.title) || 'Gracias',
        ...(p.button_mode === 'redirect' && url ? { ctaLabel: str(p.button_text) || 'Continuar', ctaUrl: url } : {}),
      }
    })
  if (lista(def.logic).length > 0) {
    avisos.push('Este Typeform tiene lógica de saltos: no se ha importado. Vuelve a montarla en la pestaña de lógica.')
  }
  const titulo = str(def.title) || 'Formulario de Typeform'
  const saneada = sanearConfig({
    welcome: w
      ? {
          title: limpiarTituloTypeform(w.title) || titulo,
          subtitle: limpiarTituloTypeform(wp.description),
          cta: str(wp.button_text),
        }
      : { title: titulo },
    questions,
    logic: [],
    endings,
  })
  return {
    name: titulo.slice(0, 160),
    category: 'otro',
    audience: 'captacion',
    config: saneada.config,
    avisos: [...avisos, ...saneada.avisos],
  }
}

// ───────────────────────────── Calendly ─────────────────────────────

const TIPO_CALENDLY: Record<string, string> = {
  string: 'shortText',
  text: 'longText',
  phone_number: 'phone',
  single_select: 'singleChoice',
  multi_select: 'multiChoice',
}

export function deCalendly(evento: Json): FormularioImportado {
  const nombre = str(evento.name) || 'Tipo de evento de Calendly'
  const avisos: string[] = []
  const propias = lista(evento.custom_questions)
    .filter((q) => q.enabled !== false)
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
    .map((q, i) => ({
      id: `pregunta-${i + 1}`,
      type: TIPO_CALENDLY[str(q.type)] ?? 'shortText',
      title: str(q.name),
      required: q.required === true,
      options: (Array.isArray(q.answer_choices) ? q.answer_choices : []).map((c) => ({ label: str(c) })),
      allowOther: q.include_other === true,
    }))
  const url = str(evento.scheduling_url)
  const yaPideTelefono = propias.some((q) => q.type === 'phone')
  const questions: Json[] = [
    // Calendly pide siempre nombre y email al reservar, aunque no figuren como preguntas del evento.
    { id: 'nombre', type: 'shortText', title: '¿Cómo te llamas?', required: true, semantic: 'contact.name' },
    { id: 'email', type: 'email', title: '¿Cuál es tu email?', required: true, semantic: 'contact.email' },
    ...propias,
  ]
  if (/^https:\/\//.test(url)) {
    questions.push({ id: 'agenda', type: 'booking', title: 'Elige día y hora', required: true, defaultValue: url })
  } else {
    avisos.push('El tipo de evento no trae enlace de reserva: añade la agenda a mano en el constructor.')
  }
  if (!yaPideTelefono) avisos.push('El evento no pedía teléfono. Añádelo si lo necesitas para contactar.')
  const saneada = sanearConfig({
    welcome: { title: nombre, subtitle: str(evento.description_plain).slice(0, 600), cta: 'Empezar' },
    questions,
    logic: [],
    endings: [{ id: 'gracias', title: 'Reserva recibida', message: 'Te hemos enviado la confirmación por email.' }],
  })
  return {
    name: nombre.slice(0, 160),
    category: 'cualificacion_cliente',
    audience: 'cualificacion',
    config: saneada.config,
    avisos: [...avisos, ...saneada.avisos],
  }
}

// ──────────────────────────── GoHighLevel ────────────────────────────

const TIPO_GHL: Record<string, string> = {
  TEXT: 'shortText',
  LARGE_TEXT: 'longText',
  NUMERICAL: 'number',
  MONETORY: 'number',
  PHONE: 'phone',
  EMAIL: 'email',
  DATE: 'date',
  SINGLE_OPTIONS: 'dropdown',
  RADIO: 'singleChoice',
  MULTIPLE_OPTIONS: 'multiChoice',
  CHECKBOX: 'multiChoice',
}
// Campos estándar del contacto tal como llegan en una respuesta de formulario de GHL, en orden de aparición.
const ESTANDAR_GHL: { claves: string[]; pregunta: Json }[] = [
  {
    claves: ['full_name', 'name', 'first_name'],
    pregunta: { id: 'nombre', type: 'shortText', title: '¿Cómo te llamas?', required: true, semantic: 'contact.name' },
  },
  {
    claves: ['email'],
    pregunta: { id: 'email', type: 'email', title: '¿Cuál es tu email?', required: true, semantic: 'contact.email' },
  },
  {
    claves: ['phone'],
    pregunta: { id: 'telefono', type: 'phone', title: '¿Y tu teléfono?', required: true, semantic: 'contact.phone' },
  },
]

/**
 * Reconstruye un formulario de GHL a partir de las claves que aparecen en sus respuestas (`others`) y del
 * catálogo de campos personalizados. Solo entra lo que se reconoce: el resto de claves de `others` son
 * metadatos del envío (sesión, página, IP…), no preguntas.
 */
export function deGhl(nombre: string, respuestas: Json[], camposPersonalizados: Json[]): FormularioImportado {
  const vistas = new Set<string>()
  for (const r of respuestas) {
    for (const [k, v] of Object.entries(esObjeto(r.others) ? r.others : {})) {
      if (v !== null && v !== undefined && v !== '') vistas.add(k)
    }
    for (const k of ['name', 'email', 'phone']) if (str(r[k])) vistas.add(k)
  }
  if (vistas.size === 0) {
    throw new Error(
      'Este formulario de GoHighLevel aún no tiene respuestas, y GoHighLevel no publica sus preguntas: no hay de dónde reconstruirlo. Copia sus preguntas y pégalas en «Crear con IA».'
    )
  }
  const avisos: string[] = []
  const questions: Json[] = ESTANDAR_GHL.filter((e) => e.claves.some((k) => vistas.has(k))).map((e) => e.pregunta)
  for (const c of camposPersonalizados) {
    const id = str(c.id)
    const clave = str(c.fieldKey).replace(/^contact\./, '')
    if (!vistas.has(id) && !(clave && vistas.has(clave))) continue
    const dataType = str(c.dataType).toUpperCase()
    const title = str(c.name)
    const type = TIPO_GHL[dataType]
    if (!type) {
      avisos.push(
        `«${title}» es de un tipo de GoHighLevel (${dataType || 'desconocido'}) que aquí no existe: no se ha importado.`
      )
      continue
    }
    const opciones = Array.isArray(c.picklistOptions) ? c.picklistOptions : Array.isArray(c.options) ? c.options : []
    questions.push({
      id: clave || id,
      type,
      title,
      placeholder: str(c.placeholder),
      options: opciones.map((o) => ({ label: esObjeto(o) ? str(o.label) || str(o.value) || str(o.name) : str(o) })),
    })
  }
  const saneada = sanearConfig({ welcome: { title: nombre }, questions, logic: [], endings: [] })
  avisos.unshift(FUENTE_INFO.ghl.nota)
  return {
    name: nombre.slice(0, 160),
    category: 'otro',
    audience: 'captacion',
    config: saneada.config,
    avisos: [...avisos, ...saneada.avisos],
  }
}

// ───────────────────────── Lectura en el proveedor ─────────────────────────

type Fetch = typeof fetch

async function getJson(f: Fetch, url: string, headers: Record<string, string>, quien: string): Promise<Json> {
  const res = await f(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15_000) })
  if (res.status === 401 || res.status === 403) {
    throw new Error(`${quien} ha rechazado la credencial (${res.status}). Revísala en Ajustes › Integraciones.`)
  }
  if (res.status === 404) throw new Error(`${quien} no encuentra ese elemento.`)
  if (!res.ok) throw new Error(`${quien} respondió ${res.status}.`)
  const j = (await res.json().catch(() => null)) as unknown
  if (!esObjeto(j)) throw new Error(`${quien} devolvió una respuesta ilegible.`)
  return j
}

const CALENDLY = 'https://api.calendly.com'
const GHL = 'https://services.leadconnectorhq.com'
const cabecerasGhl = (cfg: Cfg) => ({ Authorization: `Bearer ${cfg.GHL_API_TOKEN}`, Version: '2021-07-28' })
const cabecerasCalendly = (cfg: Cfg) => ({ Authorization: `Bearer ${cfg.CALENDLY_API_TOKEN}` })
/** Identificadores que se interpolan en una URL del proveedor: solo lo que un id real puede contener. */
const ID_PROVEEDOR = /^[A-Za-z0-9_-]{1,80}$/

export async function listarImportables(fuente: Fuente, cfg: Cfg, f: Fetch = fetch): Promise<ElementoImportable[]> {
  if (fuente === 'typeform') {
    const cliente = crearClienteTypeform(cfg.TYPEFORM_API_TOKEN ?? '', { region: cfg.TYPEFORM_REGION, fetchImpl: f })
    const forms = await cliente.listarFormularios()
    return forms.map((x) => ({ id: x.id, nombre: x.titulo })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }
  if (fuente === 'calendly') {
    const yo = await getJson(f, `${CALENDLY}/users/me`, cabecerasCalendly(cfg), 'Calendly')
    const recurso = esObjeto(yo.resource) ? yo.resource : {}
    const org = str(recurso.current_organization)
    const usuario = str(recurso.uri)
    const leer = (filtro: string) =>
      getJson(f, `${CALENDLY}/event_types?${filtro}&active=true&count=100`, cabecerasCalendly(cfg), 'Calendly')
    // Todos los eventos de la organización si el token puede verlos; si no, los de la propia persona.
    const j = org
      ? await leer(`organization=${encodeURIComponent(org)}`).catch(() => leer(`user=${encodeURIComponent(usuario)}`))
      : await leer(`user=${encodeURIComponent(usuario)}`)
    return lista(j.collection)
      .map((e) => {
        const perfil = esObjeto(e.profile) ? str(e.profile.name) : ''
        return { id: str(e.uri).split('/').pop() ?? '', nombre: str(e.name), detalle: perfil || undefined }
      })
      .filter((e) => ID_PROVEEDOR.test(e.id) && e.nombre)
  }
  const loc = encodeURIComponent(cfg.GHL_LOCATION_ID ?? '')
  const j = await getJson(f, `${GHL}/forms/?locationId=${loc}&limit=50`, cabecerasGhl(cfg), 'GoHighLevel')
  return lista(j.forms)
    .map((x) => ({ id: str(x.id), nombre: str(x.name) }))
    .filter((x) => ID_PROVEEDOR.test(x.id) && x.nombre)
}

export async function importarFormulario(
  fuente: Fuente,
  id: string,
  cfg: Cfg,
  f: Fetch = fetch
): Promise<FormularioImportado> {
  if (!ID_PROVEEDOR.test(id)) throw new Error('Identificador no válido.')
  if (fuente === 'typeform') {
    const def = await getJson(
      f,
      `${baseTypeform(cfg.TYPEFORM_REGION)}/forms/${encodeURIComponent(id)}`,
      { Authorization: `Bearer ${cfg.TYPEFORM_API_TOKEN}` },
      'Typeform'
    )
    return deTypeform(def)
  }
  if (fuente === 'calendly') {
    const j = await getJson(f, `${CALENDLY}/event_types/${encodeURIComponent(id)}`, cabecerasCalendly(cfg), 'Calendly')
    return deCalendly(esObjeto(j.resource) ? j.resource : {})
  }
  const loc = encodeURIComponent(cfg.GHL_LOCATION_ID ?? '')
  const [forms, envios, campos] = await Promise.all([
    getJson(f, `${GHL}/forms/?locationId=${loc}&limit=50`, cabecerasGhl(cfg), 'GoHighLevel'),
    getJson(
      f,
      `${GHL}/forms/submissions?locationId=${loc}&formId=${encodeURIComponent(id)}&limit=20`,
      cabecerasGhl(cfg),
      'GoHighLevel'
    ),
    getJson(f, `${GHL}/locations/${loc}/customFields`, cabecerasGhl(cfg), 'GoHighLevel'),
  ])
  const nombre = str(lista(forms.forms).find((x) => str(x.id) === id)?.name) || 'Formulario de GoHighLevel'
  return deGhl(nombre, lista(envios.submissions), lista(campos.customFields))
}
