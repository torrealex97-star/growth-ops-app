import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  MAX_RONDAS_PREGUNTAS,
  extraerJson,
  interpretarRespuesta,
  prepararPeticion,
  turnoCreador,
} from '../lib/forms/ai-builder.ts'
import {
  deCalendly,
  deGhl,
  deTypeform,
  fuenteConectada,
  importarFormulario,
  limpiarTituloTypeform,
  listarImportables,
} from '../lib/forms/importar.ts'
import { idSeguro, sanearConfig } from '../lib/forms/normalizar.ts'
import { formConfigSchema } from '../lib/forms/schema.ts'
import { validateConfig } from '../lib/forms/validation.ts'

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const valida = (config) => {
  assert.equal(formConfigSchema.safeParse(config).success, true)
  assert.deepEqual(validateConfig(config), [])
}

// ───────────── saneado ─────────────

test('sanearConfig: ids legibles y únicos, y las referencias siguen al id nuevo', () => {
  const { config } = sanearConfig({
    questions: [
      { id: 'Tu Facturación!', type: 'singleChoice', title: 'Facturación', options: ['Menos de 1k', 'Más de 1k'] },
      { id: 'Tu Facturación!', type: 'text', title: 'Otra' },
      {
        id: 'q3',
        type: 'longText',
        title: 'Cuéntanos',
        showIf: { match: 'all', conditions: [{ questionId: 'Tu Facturación!', op: 'equals', value: 'mas-de-1k' }] },
      },
    ],
    logic: [
      {
        from: 'Tu Facturación!',
        when: { match: 'all', conditions: [{ questionId: 'Tu Facturación!', op: 'isAnswered' }] },
        then: { type: 'end', endingId: 'Fin Bueno' },
      },
      {
        from: 'no-existe',
        when: { match: 'all', conditions: [{ questionId: 'q3', op: 'isAnswered' }] },
        then: { type: 'jump', target: 'q3' },
      },
    ],
    endings: [
      {
        id: 'Fin Bueno',
        title: 'Genial',
        when: { match: 'all', conditions: [{ questionId: '$temperature', op: 'equals', value: 'caliente' }] },
      },
      { title: 'Gracias' },
    ],
  })
  valida(config)
  assert.deepEqual(
    config.questions.map((q) => q.id),
    ['tu-facturacion', 'tu-facturacion-2', 'q3']
  )
  assert.equal(config.questions[1].type, 'shortText', 'alias «text» → shortText')
  assert.equal(config.questions[2].showIf.conditions[0].questionId, 'tu-facturacion')
  assert.equal(config.logic.length, 1, 'la regla que sale de una pregunta inexistente se descarta')
  assert.equal(config.logic[0].then.endingId, 'fin-bueno')
  assert.equal(config.endings.filter((e) => e.isDefault).length, 1)
  assert.equal(config.endings.find((e) => e.isDefault).when, undefined)
})

test('sanearConfig: avisa de lo que cambia y no deja pasar lo inválido', () => {
  const { config, avisos } = sanearConfig({
    questions: [
      { type: 'singleChoice', title: 'Sin opciones', options: ['una'] },
      { type: 'inventado', title: 'Tipo raro' },
      { type: 'email', title: 'Email' },
      { type: 'email', title: 'Email de facturación', semantic: 'contact.email' },
      { type: 'phone', title: 'Teléfono', imageUrl: 'http://inseguro.test/x.png' },
      { type: 'booking', title: 'Agenda', defaultValue: 'javascript:alert(1)' },
    ],
    endings: [{ title: 'Fin', ctaLabel: 'Ir', ctaUrl: 'javascript:alert(1)', redirectUrl: 'ftp://x' }],
    scoring: { enabled: true, weights: [{ questionId: 'no-existe', value: 'a', points: 50 }] },
  })
  valida(config)
  assert.equal(config.questions[0].type, 'shortText')
  assert.equal(avisos.length, 2)
  assert.equal(config.questions.filter((q) => q.semantic === 'contact.email').length, 1)
  assert.equal(
    config.questions[4].semantic,
    'contact.phone',
    'el teléfono se enlaza al contacto aunque nadie lo marque'
  )
  assert.equal(config.questions[4].imageUrl, undefined)
  assert.equal(config.questions[5].defaultValue, undefined)
  assert.equal(config.endings[0].ctaUrl, undefined)
  assert.equal(config.endings[0].redirectUrl, undefined)
  assert.equal(config.scoring, undefined, 'una puntuación que no apunta a nada no se guarda')
  assert.throws(() => sanearConfig({ questions: [{ type: 'statement', title: 'Solo texto' }] }), /ninguna pregunta/)
  assert.throws(() => sanearConfig('nada'), /no es un objeto/)
  assert.equal(idSeguro('  ¿Cuál es tu Año?  ', 'x'), 'cual-es-tu-ano')
})

// ───────────── creador con IA ─────────────

const FORM_IA = JSON.stringify({
  type: 'form',
  message: 'He asumido que es para llamadas de venta.',
  name: 'Cualificación llamada',
  category: 'cualificacion_cliente',
  audience: 'cualificacion',
  config: {
    welcome: { title: 'Antes de la llamada', cta: 'Empezar' },
    questions: [
      { id: 'nombre', type: 'shortText', title: '¿Cómo te llamas?', required: true, semantic: 'contact.name' },
      { id: 'email', type: 'email', title: '¿Tu email?', required: true },
      {
        id: 'invertir',
        type: 'yesNo',
        title: '¿Puedes invertir ahora?',
        required: true,
        semantic: 'qualification.invertir',
      },
    ],
    logic: [],
    endings: [{ id: 'gracias', title: 'Gracias' }],
    scoring: {
      enabled: true,
      thresholds: { caliente: 70, templado: 40 },
      weights: [{ questionId: 'invertir', value: 'yes', points: 100 }],
    },
  },
})

test('interpretarRespuesta: preguntas de aclaración o formulario, también con el JSON envuelto', () => {
  const p = interpretarRespuesta(
    '```json\n{"type":"questions","message":"Me falta saber","questions":["¿Para quién es?","",3]}\n```'
  )
  assert.deepEqual(p, { type: 'questions', message: 'Me falta saber', questions: ['¿Para quién es?'] })
  const f = interpretarRespuesta(`Aquí lo tienes:\n${FORM_IA}`)
  assert.equal(f.type, 'form')
  assert.equal(f.audience, 'cualificacion')
  valida(f.config)
  assert.equal(f.config.scoring.weights[0].points, 100)
  assert.equal(interpretarRespuesta(FORM_IA.replace('cualificacion_cliente', 'inventada')).category, 'otro')
  assert.throws(() => interpretarRespuesta('no hay json'), /JSON/)
  assert.throws(() => interpretarRespuesta('{"type":"otra"}'), /type/)
  assert.throws(() => extraerJson('{"a": '), /JSON/)
})

test('prepararPeticion: tras las rondas máximas ya no puede preguntar; con formulario actual, lo edita', () => {
  const ronda = (n) =>
    Array.from({ length: n }, () => [
      { role: 'user', content: 'quiero un formulario' },
      { role: 'assistant', content: '¿Para quién?' },
    ]).flat()
  const antes = prepararPeticion([...ronda(MAX_RONDAS_PREGUNTAS - 1), { role: 'user', content: 'x' }])
  assert.doesNotMatch(antes.system, /YA HAS PREGUNTADO SUFICIENTE/)
  const tope = prepararPeticion([...ronda(MAX_RONDAS_PREGUNTAS), { role: 'user', content: 'x' }])
  assert.match(tope.system, /YA HAS PREGUNTADO SUFICIENTE/)
  const actual = interpretarRespuesta(FORM_IA)
  const edicion = prepararPeticion([...ronda(5), { role: 'user', content: 'quita el email' }], actual)
  assert.match(edicion.system, /FORMULARIO ACTUAL/)
  assert.match(edicion.system, /"invertir"/)
  assert.doesNotMatch(
    edicion.system,
    /YA HAS PREGUNTADO SUFICIENTE/,
    'editando sí puede pedir que le aclaren el cambio'
  )
  assert.equal(
    prepararPeticion([
      { role: 'assistant', content: 'hola' },
      { role: 'user', content: 'x' },
    ]).messages[0].role,
    'user'
  )
})

test('turnoCreador: si la IA devuelve algo inservible se le explica y se reintenta UNA vez', async () => {
  const llamadas = []
  const completar = (respuestas) => async (req) => {
    llamadas.push(req)
    return { text: respuestas.shift(), engine: 'anthropic', model: 'm' }
  }
  const turnos = [{ role: 'user', content: 'Un formulario de cualificación' }]
  const ok = await turnoCreador(turnos, null, {}, completar(['{"type":"form","config":{"questions":[]}}', FORM_IA]))
  assert.equal(ok.type, 'form')
  assert.equal(llamadas.length, 2)
  assert.match(llamadas[1].messages.at(-1).content, /no se puede usar/)
  llamadas.length = 0
  await assert.rejects(
    turnoCreador(turnos, null, {}, completar(['basura', 'más basura'])),
    /no ha devuelto un formulario válido/
  )
  assert.equal(llamadas.length, 2, 'no entra en bucle')
  await assert.rejects(turnoCreador([], null, {}, completar([])), /Describe el formulario/)
})

// ───────────── importadores ─────────────

test('Typeform: preguntas, opciones, contacto y final; lo que no existe aquí se avisa', () => {
  const r = deTypeform({
    title: 'Solicitud',
    welcome_screens: [{ title: 'Hola *tú*', properties: { description: 'Dos minutos', button_text: 'Vamos' } }],
    hidden: ['utm_source'],
    logic: [{ type: 'field', ref: 'a', actions: [] }],
    fields: [
      {
        ref: 'c1',
        type: 'contact_info',
        title: 'Tus datos',
        properties: {
          fields: [
            { ref: 'n', title: 'Nombre', subfield_key: 'first_name', validations: { required: true } },
            { ref: 'e', title: 'Email', subfield_key: 'email' },
            { ref: 't', title: 'Teléfono', subfield_key: 'phone_number' },
          ],
        },
      },
      {
        ref: 'sit',
        type: 'multiple_choice',
        title: 'Hola {{field:n}}, ¿tu situación?',
        validations: { required: true },
        properties: { choices: [{ label: 'Autónomo' }, { label: 'Empresa' }], allow_other_choice: true },
      },
      {
        ref: 'varios',
        type: 'multiple_choice',
        title: 'Canales',
        properties: { allow_multiple_selection: true, choices: [{ label: 'Meta' }, { label: 'Google' }] },
      },
      {
        ref: 'esc',
        type: 'opinion_scale',
        title: 'Urgencia',
        properties: { steps: 10, labels: { left: 'Poca', right: 'Mucha' } },
      },
      { ref: 'doc', type: 'file_upload', title: 'Sube tu CV' },
      {
        ref: 'grp',
        type: 'group',
        title: 'Grupo',
        properties: { fields: [{ ref: 'web', type: 'website', title: 'Tu web' }] },
      },
    ],
    thankyou_screens: [
      {
        ref: 'fin',
        title: 'Hecho',
        properties: { button_mode: 'redirect', button_text: 'Seguir', redirect_url: 'https://ejemplo.test/gracias' },
      },
      { ref: 'default_tys', title: 'Gracias' },
    ],
  })
  valida(r.config)
  const q = Object.fromEntries(r.config.questions.map((x) => [x.id, x]))
  assert.equal(q.n.semantic, 'contact.name')
  assert.equal(q.e.semantic, 'contact.email')
  assert.equal(q.t.type, 'phone')
  assert.equal(q.sit.title, 'Hola, ¿tu situación?')
  assert.deepEqual(
    [q.sit.type, q.sit.required, q.sit.allowOther, q.sit.options.length],
    ['singleChoice', true, true, 2]
  )
  assert.equal(q.varios.type, 'multiChoice')
  assert.deepEqual([q.esc.type, q.esc.scaleMax, q.esc.scaleLabels.max], ['scale', 10, 'Mucha'])
  assert.equal(q.web.type, 'url')
  assert.equal(q.utm_source.hiddenKey, 'utm_source')
  assert.equal(q.doc, undefined)
  assert.equal(r.config.welcome.title, 'Hola tú')
  assert.equal(r.config.endings[0].ctaUrl, 'https://ejemplo.test/gracias')
  assert.equal(r.avisos.length, 2, 'la subida de archivos y la lógica de saltos se avisan')
  assert.equal(limpiarTituloTypeform('¿Y _tú_ {{hidden:nombre}} ?'), '¿Y tú?')
})

test('Calendly: nombre y email delante, sus preguntas en orden y la agenda al final', () => {
  const r = deCalendly({
    name: 'Llamada de estrategia',
    scheduling_url: 'https://calendly.com/ejemplo/llamada',
    custom_questions: [
      {
        name: 'Presupuesto',
        type: 'single_select',
        position: 1,
        enabled: true,
        required: true,
        answer_choices: ['<1k', '>1k'],
        include_other: false,
      },
      { name: 'Apagada', type: 'string', position: 0, enabled: false },
      { name: 'Tu teléfono', type: 'phone_number', position: 0, enabled: true, required: true },
    ],
  })
  valida(r.config)
  assert.deepEqual(
    r.config.questions.map((q) => q.title),
    ['¿Cómo te llamas?', '¿Cuál es tu email?', 'Tu teléfono', 'Presupuesto', 'Elige día y hora']
  )
  assert.equal(r.config.questions.at(-1).defaultValue, 'https://calendly.com/ejemplo/llamada')
  assert.equal(r.config.questions[2].semantic, 'contact.phone')
  assert.equal(r.config.questions[3].options.length, 2)
  assert.equal(r.audience, 'cualificacion')
  assert.match(deCalendly({ name: 'X', custom_questions: [] }).avisos.join(' '), /enlace de reserva/)
})

test('GoHighLevel: se reconstruye de las respuestas; sin respuestas se dice y no se inventa', () => {
  const campos = [
    {
      id: 'cf1',
      name: 'Facturación mensual',
      fieldKey: 'contact.facturacion',
      dataType: 'RADIO',
      picklistOptions: ['<3k', '>3k'],
    },
    { id: 'cf2', name: 'No usado en este formulario', dataType: 'TEXT' },
    { id: 'cf3', name: 'Firma', dataType: 'SIGNATURE' },
  ]
  const r = deGhl(
    'Captación',
    [
      {
        email: 'a@ejemplo.test',
        others: { full_name: 'A', cf1: '<3k', cf3: 'x', sessionId: 's', eventData: { a: 1 } },
      },
    ],
    campos
  )
  valida(r.config)
  assert.deepEqual(
    r.config.questions.map((q) => q.id),
    ['nombre', 'email', 'facturacion']
  )
  assert.equal(r.config.questions[2].type, 'singleChoice')
  assert.match(r.avisos[0], /no publica las preguntas/)
  assert.match(r.avisos.join(' '), /SIGNATURE/)
  assert.throws(() => deGhl('Vacío', [], campos), /aún no tiene respuestas/)
})

test('lectura en el proveedor: credencial de la subcuenta, ids acotados y errores legibles', async () => {
  assert.equal(fuenteConectada('ghl', { GHL_API_TOKEN: 't' }), false, 'GHL necesita token Y location')
  assert.equal(fuenteConectada('ghl', { GHL_API_TOKEN: 't', GHL_LOCATION_ID: 'l' }), true)
  assert.equal(fuenteConectada('typeform', { TYPEFORM_API_TOKEN: ' ' }), false)

  const vistas = []
  const f = (respuestas) => async (url, init) => {
    vistas.push({ url: String(url), auth: init.headers.Authorization })
    const r = respuestas.shift()
    return { ok: r.status === 200, status: r.status, json: async () => r.body }
  }
  const items = await listarImportables(
    'calendly',
    { CALENDLY_API_TOKEN: 'tok' },
    f([
      {
        status: 200,
        body: {
          resource: {
            uri: 'https://api.calendly.com/users/U1',
            current_organization: 'https://api.calendly.com/organizations/O1',
          },
        },
      },
      {
        status: 200,
        body: {
          collection: [
            { uri: 'https://api.calendly.com/event_types/EV1', name: 'Llamada', profile: { name: 'Equipo' } },
          ],
        },
      },
    ])
  )
  assert.deepEqual(items, [{ id: 'EV1', nombre: 'Llamada', detalle: 'Equipo' }])
  assert.match(vistas[1].url, /organization=/)
  assert.equal(vistas[1].auth, 'Bearer tok')

  await assert.rejects(importarFormulario('typeform', '../admin', { TYPEFORM_API_TOKEN: 't' }, f([])), /no válido/)
  await assert.rejects(
    importarFormulario(
      'typeform',
      'abc',
      { TYPEFORM_API_TOKEN: 't', TYPEFORM_REGION: 'eu' },
      f([{ status: 401, body: {} }])
    ),
    /rechazado la credencial/
  )
  assert.match(vistas.at(-1).url, /^https:\/\/api\.eu\.typeform\.com\/forms\/abc$/)
})

// ───────────── cableado ─────────────

test('rutas: solo roles de escritura, credencial sin relevo global, y la IA nunca escribe en BD', () => {
  const ia = leer('app/api/[tenant]/evergreen/forms/ai/route.ts')
  assert.match(ia, /authorizeForms\(tenant, true\)/)
  assert.match(ia, /tenantAiEnv\(g\.auth\.tenantId\)/)
  assert.doesNotMatch(ia, /\.insert\(|\.update\(|\.upsert\(/)
  const imp = leer('app/api/[tenant]/evergreen/forms/import/route.ts')
  assert.equal((imp.match(/authorizeForms\(tenant, true\)/g) ?? []).length, 2)
  assert.match(imp, /getTenantConfig\(g\.auth\.tenantId\)/)
  assert.doesNotMatch(imp, /getTenantConfigWithFallback\(/, 'con relevo se listarían formularios de la cuenta global')
  assert.doesNotMatch(imp, /\.insert\(|\.update\(|\.upsert\(/)
  const crear = leer('app/api/[tenant]/evergreen/forms/route.ts')
  assert.match(crear, /config: formConfigSchema\.optional\(\)/)
  assert.match(crear, /validateConfig\(b\.config/)
  const prompt = leer('lib/forms/ai-builder.ts')
  assert.match(prompt, /Nunca uses emojis/, 'las páginas públicas no admiten emojis')
})
