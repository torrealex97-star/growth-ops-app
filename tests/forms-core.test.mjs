import assert from 'node:assert/strict'
import test from 'node:test'

import {
  evaluateGroup,
  getPathAnswers,
  nextStep,
  pipe,
  pipeUrl,
  resolveEnding,
  safeRedirectUrl,
  walkPath,
} from '../lib/forms/logic.ts'
import { stripForPublic } from '../lib/forms/public.ts'
import { formConfigSchema } from '../lib/forms/schema.ts'
import { computeScore, temperatureFor } from '../lib/forms/scoring.ts'
import { extractSemantic } from '../lib/forms/semantic.ts'
import { validateAnswer, validateConfig, validateSubmission } from '../lib/forms/validation.ts'

const all = (...conditions) => ({ match: 'all', conditions })

// Feedback de una clase: estrellas -> (>=4) final Trustpilot, (<4) mejora -> gracias.
const feedback = () => ({
  schemaVersion: 1,
  questions: [
    {
      id: 'profe',
      type: 'dropdown',
      title: 'Profesor',
      required: true,
      semantic: 'teacher',
      options: [
        { value: 'a', label: 'Ana' },
        { value: 'b', label: 'Beto' },
      ],
    },
    {
      id: 'estrellas',
      type: 'rating',
      title: '¿Cómo valoras la clase de {{profe}}?',
      required: true,
      semantic: 'rating',
    },
    { id: 'mejora', type: 'longText', title: '¿Qué mejorarías?', required: true },
    { id: 'email', type: 'email', title: 'Email', semantic: 'contact.email' },
    { id: 'utm', type: 'hidden', title: '', hiddenKey: 'utm_source' },
  ],
  logic: [
    {
      id: 'r1',
      from: 'estrellas',
      when: all({ questionId: 'estrellas', op: 'gte', value: 4 }),
      then: { type: 'end', endingId: 'trustpilot' },
    },
  ],
  endings: [
    {
      id: 'trustpilot',
      title: 'Gracias',
      redirectUrl: '{{trustpilot_url}}',
      when: all({ questionId: 'estrellas', op: 'gte', value: 4 }),
    },
    { id: 'gracias', title: 'Gracias por tu feedback', isDefault: true },
  ],
})

test('estrellas >= 4 saltan a Trustpilot sin pasar por "mejora"', () => {
  const c = feedback()
  const a = { profe: 'a', estrellas: 5, mejora: 'texto que no debe viajar' }
  const path = walkPath(c, a)
  assert.deepEqual(path.questionIds, ['profe', 'estrellas'])
  assert.equal(path.endingId, 'trustpilot')
  // Anti-contaminación: lo contestado en la rama que ya no se recorre se descarta.
  assert.equal(getPathAnswers(c, a).mejora, undefined)
})

test('estrellas < 4 siguen por "mejora" y acaban en el final por defecto', () => {
  const c = feedback()
  const a = { profe: 'b', estrellas: 2, mejora: 'más ejemplos' }
  const path = walkPath(c, a)
  assert.deepEqual(path.questionIds, ['profe', 'estrellas', 'mejora', 'email'])
  assert.equal(path.endingId, 'gracias')
})

test('un salto hacia atrás se ignora (no hay bucles)', () => {
  const c = feedback()
  c.logic = [
    {
      id: 'loop',
      from: 'mejora',
      when: all({ questionId: 'mejora', op: 'isAnswered' }),
      then: { type: 'jump', target: 'profe' },
    },
  ]
  const step = nextStep(c, 'mejora', { mejora: 'x', estrellas: 1, profe: 'a' })
  assert.equal(step.kind, 'question')
  assert.equal(step.id, 'email')
})

test('showIf oculta preguntas y la regla "any" funciona', () => {
  const c = {
    schemaVersion: 1,
    questions: [
      { id: 'listo', type: 'yesNo', title: '¿Listo?', required: true },
      {
        id: 'objecion',
        type: 'singleChoice',
        title: 'Objeción',
        showIf: all({ questionId: 'listo', op: 'equals', value: 'no' }),
        options: [
          { value: 'precio', label: 'Precio' },
          { value: 'tiempo', label: 'Tiempo' },
        ],
      },
      { id: 'tel', type: 'phone', title: 'Teléfono', required: true },
    ],
    logic: [],
    endings: [{ id: 'fin', title: 'Fin', isDefault: true }],
  }
  assert.deepEqual(walkPath(c, { listo: 'yes' }).questionIds, ['listo', 'tel'])
  assert.deepEqual(walkPath(c, { listo: 'no' }).questionIds, ['listo', 'objecion', 'tel'])
  assert.equal(
    evaluateGroup(
      {
        match: 'any',
        conditions: [
          { questionId: 'listo', op: 'equals', value: 'x' },
          { questionId: 'listo', op: 'equals', value: 'yes' },
        ],
      },
      { listo: 'yes' }
    ),
    true
  )
})

test('los finales condicionales pueden depender de $score en el servidor', () => {
  const c = feedback()
  c.endings = [
    { id: 'vip', title: 'VIP', when: all({ questionId: '$temperature', op: 'equals', value: 'caliente' }) },
    { id: 'normal', title: 'Normal', isDefault: true },
  ]
  assert.equal(resolveEnding(c, {}, { temperature: 'caliente' }).id, 'vip')
  assert.equal(resolveEnding(c, {}, { temperature: 'frio' }).id, 'normal')
  // Sin variables (navegador) nunca se cumple: el cliente cae al por defecto y el servidor decide.
  assert.equal(resolveEnding(c, {}).id, 'normal')
})

test('piping resuelve etiquetas y variables; las URLs se codifican', () => {
  const c = feedback()
  assert.equal(pipe('Clase de {{profe}} {{nada}}', c, { profe: 'a' }), 'Clase de Ana ')
  assert.equal(pipe('{{trustpilot_url}}', c, {}, { trustpilot_url: 'https://x.test/r' }), 'https://x.test/r')
  assert.equal(pipeUrl('https://a.test/?n={{profe}}', c, { profe: 'a' }), 'https://a.test/?n=Ana')
  assert.equal(pipeUrl('{{u}}', c, {}, { u: 'https://t.test/review/x' }), 'https://t.test/review/x')
})

test('solo se redirige a http(s)', () => {
  assert.equal(safeRedirectUrl('javascript:alert(1)'), null)
  assert.equal(safeRedirectUrl('data:text/html,x'), null)
  assert.equal(safeRedirectUrl('nope'), null)
  assert.ok(safeRedirectUrl('https://es.trustpilot.com/review/x'))
})

test('scoring: suma, recorta a 0-100 y fija temperatura/etiqueta', () => {
  const c = {
    ...feedback(),
    scoring: {
      enabled: true,
      tagPrefix: 'cual',
      thresholds: { caliente: 70, templado: 40 },
      weights: [
        { questionId: 'listo', value: 'yes', points: 45 },
        { questionId: 'fact', in: ['3000+', '1500-3000'], points: 35 },
        { questionId: 'sit', value: 'autonomo', points: 15 },
        { questionId: 'multi', value: 'b', points: 500 },
      ],
    },
  }
  const r = computeScore(c, { listo: 'yes', fact: '3000+', sit: 'autonomo' })
  assert.deepEqual(r, { score: 95, temperature: 'caliente', tag: 'cual_caliente' })
  assert.equal(computeScore(c, { multi: ['a', 'b'] }).score, 100)
  assert.equal(computeScore(c, {}).temperature, 'frio')
  assert.equal(temperatureFor(40, c.scoring.thresholds), 'templado')
  assert.equal(computeScore({ ...c, scoring: { ...c.scoring, enabled: false } }, {}), null)
})

test('la versión pública no lleva pesos de scoring', () => {
  const pub = stripForPublic({
    ...feedback(),
    scoring: { enabled: true, weights: [], thresholds: { caliente: 1, templado: 1 } },
  })
  assert.equal(pub.scoring, undefined)
  assert.ok(!JSON.stringify(pub).includes('thresholds'))
})

test('validación por tipo, con mensajes en español', () => {
  const q = (o) => ({ id: 'q', title: 't', ...o })
  assert.equal(validateAnswer(q({ type: 'email' }), 'a@b.co'), null)
  assert.match(validateAnswer(q({ type: 'email', required: true }), 'nope'), /email/)
  assert.match(validateAnswer(q({ type: 'shortText', required: true }), ''), /obligatoria/)
  assert.equal(validateAnswer(q({ type: 'shortText' }), ''), null)
  assert.equal(validateAnswer(q({ type: 'shortText', required: true }), '', { partial: true }), null)
  assert.equal(validateAnswer(q({ type: 'phone' }), '+34 600 123 456'), null)
  assert.match(validateAnswer(q({ type: 'phone' }), '12'), /teléfono/)
  assert.equal(validateAnswer(q({ type: 'url' }), 'miportfolio.com/x'), null)
  assert.equal(validateAnswer(q({ type: 'rating' }), 5), null)
  assert.match(validateAnswer(q({ type: 'rating' }), 6), /valoración/)
  assert.equal(validateAnswer(q({ type: 'nps' }), 0), null)
  assert.match(validateAnswer(q({ type: 'nps' }), 11), /0 a 10/)
  assert.equal(validateAnswer(q({ type: 'number', min: 1, max: 3 }), '2'), null)
  assert.match(validateAnswer(q({ type: 'number', min: 1 }), 0), /mínimo/)
  const opts = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ]
  assert.equal(validateAnswer(q({ type: 'singleChoice', options: opts }), 'a'), null)
  assert.match(validateAnswer(q({ type: 'singleChoice', options: opts }), 'z'), /opciones/)
  assert.equal(validateAnswer(q({ type: 'singleChoice', options: opts, allowOther: true }), 'other:mi caso'), null)
  assert.match(validateAnswer(q({ type: 'multiChoice', options: opts, max: 1 }), ['a', 'b']), /máximo/)
  assert.match(validateAnswer(q({ type: 'consent', required: true }), false), /aceptar/)
})

test('validateSubmission: solo exige lo del camino real y rechaza claves desconocidas', () => {
  const c = feedback()
  // 5 estrellas: "mejora" (obligatoria) no está en el camino, no debe exigirse.
  const ok = validateSubmission(c, { profe: 'a', estrellas: 5 })
  assert.equal(ok.ok, true)
  assert.equal(ok.endingId, 'trustpilot')
  const bad = validateSubmission(c, { profe: 'a', estrellas: 2 })
  assert.equal(bad.ok, false)
  assert.match(bad.errors.mejora, /obligatoria/)
  const unknown = validateSubmission(c, { profe: 'a', estrellas: 5, inventada: 'x' })
  assert.equal(unknown.ok, false)
  assert.match(unknown.errors.inventada, /desconocida/)
  // La captura progresiva (partial) no exige obligatorias pero sí formato.
  assert.equal(validateSubmission(c, { profe: 'a' }, {}, { partial: true }).ok, true)
  assert.equal(validateSubmission(c, { email: 'mal' }, {}, { partial: true }).ok, false)
})

test('extractSemantic devuelve etiquetas legibles y contacto normalizado', () => {
  const c = feedback()
  const s = extractSemantic(c, { profe: 'b', estrellas: 4, email: '  ALU@Example.TEST ' })
  assert.equal(s.teacher, 'Beto')
  assert.equal(s.rating, 4)
  assert.equal(s.email, 'alu@example.test')
  assert.equal(s.nps, null)
})

test('validateConfig detecta lo que impediría publicar', () => {
  assert.deepEqual(validateConfig(feedback()), [])
  const roto = feedback()
  roto.logic.push({ id: 'x', from: 'estrellas', when: all(), then: { type: 'jump', target: 'noexiste' } })
  roto.questions.push({ id: 'profe', type: 'shortText', title: 'dup' })
  roto.questions.push({ id: 'sel', type: 'singleChoice', title: 'Una', options: [{ value: 'a', label: 'A' }] })
  const problems = validateConfig(roto)
  assert.ok(problems.some((p) => p.includes('repetido')))
  assert.ok(problems.some((p) => p.includes('destino no existe')))
  assert.ok(problems.some((p) => p.includes('al menos dos opciones')))
})

test('el esquema zod acepta una config válida y rechaza ids raros y excesos', () => {
  assert.equal(formConfigSchema.safeParse(feedback()).success, true)
  const malo = feedback()
  malo.questions[0].id = 'con espacios'
  assert.equal(formConfigSchema.safeParse(malo).success, false)
  const sinFin = { ...feedback(), endings: [] }
  assert.equal(formConfigSchema.safeParse(sinFin).success, false)
  const rol = feedback()
  rol.questions[1].semantic = 'admin.todo'
  assert.equal(formConfigSchema.safeParse(rol).success, false)
})

test('evaluateSubmission: 5 estrellas redirige a Trustpilot (variable del servidor) y guarda semántica', async () => {
  const { evaluateSubmission } = await import('../lib/forms/submission.ts')
  const c = feedback()
  const ok = evaluateSubmission(c, {
    answers: { profe: 'a', estrellas: 5 },
    hidden: { utm_source: 'ig', otro: 'ignorado' },
    vars: { trustpilot_url: 'https://es.trustpilot.com/review/ejemplo.test' },
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.endingId, 'trustpilot')
  assert.equal(ok.redirectUrl, 'https://es.trustpilot.com/review/ejemplo.test')
  assert.equal(ok.semantic.teacher, 'Ana')
  assert.deepEqual(ok.hidden, { utm_source: 'ig' })

  const bajo = evaluateSubmission(c, { answers: { profe: 'a', estrellas: 2, mejora: 'más práctica' } })
  assert.equal(bajo.ok, true)
  assert.equal(bajo.endingId, 'gracias')
  assert.equal(bajo.redirectUrl, null)

  // Sin la URL configurada el redirect queda en null (nunca "undefined" ni una URL rota).
  assert.equal(evaluateSubmission(c, { answers: { profe: 'a', estrellas: 5 } }).redirectUrl, null)
  assert.equal(evaluateSubmission(c, { answers: { profe: 'a', estrellas: 2 } }).ok, false)
})

test('evaluateSubmission: el final puede depender de la temperatura calculada en el servidor', async () => {
  const { evaluateSubmission } = await import('../lib/forms/submission.ts')
  const c = {
    schemaVersion: 1,
    questions: [{ id: 'listo', type: 'yesNo', title: '¿Listo?', required: true }],
    logic: [],
    endings: [
      { id: 'vip', title: 'Agenda ya', when: all({ questionId: '$temperature', op: 'equals', value: 'caliente' }) },
      { id: 'resto', title: 'Gracias', isDefault: true },
    ],
    scoring: {
      enabled: true,
      thresholds: { caliente: 50, templado: 20 },
      weights: [{ questionId: 'listo', value: 'yes', points: 60 }],
    },
  }
  assert.equal(evaluateSubmission(c, { answers: { listo: 'yes' } }).endingId, 'vip')
  assert.equal(evaluateSubmission(c, { answers: { listo: 'no' } }).endingId, 'resto')
})

test('todas las plantillas son válidas, publicables y con lógica coherente', async () => {
  const { FORM_TEMPLATES, blankConfig } = await import('../lib/forms/templates/index.ts')
  assert.equal(FORM_TEMPLATES.length, 7)
  const keys = new Set()
  for (const t of [...FORM_TEMPLATES, { key: 'blank', name: 'b', config: blankConfig() }]) {
    assert.ok(!keys.has(t.key), `clave repetida ${t.key}`)
    keys.add(t.key)
    assert.equal(formConfigSchema.safeParse(t.config).success, true, `${t.key}: no pasa el esquema`)
    assert.deepEqual(validateConfig(t.config), [], `${t.key}: no es publicable`)
    assert.doesNotMatch(JSON.stringify(t.config), /\p{Extended_Pictographic}/u, `${t.key}: emojis`)
  }
})

test('plantillas de feedback: estrellas >= 4 → Trustpilot y < 4 → mejora; NPS >= 9 → Trustpilot', async () => {
  const { FORM_TEMPLATES } = await import('../lib/forms/templates/index.ts')
  const { evaluateSubmission } = await import('../lib/forms/submission.ts')
  const vars = { trustpilot_url: 'https://es.trustpilot.com/review/ejemplo.test' }
  for (const key of ['feedback-clase-directo', 'feedback-modulo']) {
    const t = FORM_TEMPLATES.find((x) => x.key === key)
    const base = key === 'feedback-modulo' ? { modulo: 'modulo-1' } : { profesor: 'profesor-1' }
    const alta = evaluateSubmission(t.config, { answers: { ...base, estrellas: 5 }, vars })
    assert.equal(alta.ok, true, key)
    assert.equal(alta.redirectUrl, vars.trustpilot_url)
    assert.equal(
      evaluateSubmission(t.config, { answers: { ...base, estrellas: 3 }, vars }).ok,
      false,
      'sin mejora no vale'
    )
    const baja = evaluateSubmission(t.config, { answers: { ...base, estrellas: 3, mejora: 'más ejemplos' }, vars })
    assert.equal(baja.ok, true)
    assert.equal(baja.redirectUrl, null)
    assert.equal(baja.endingId, 'gracias')
  }
  const nps = FORM_TEMPLATES.find((x) => x.key === 'nps-cliente')
  assert.equal(evaluateSubmission(nps.config, { answers: { nps: 10 }, vars }).redirectUrl, vars.trustpilot_url)
  assert.equal(evaluateSubmission(nps.config, { answers: { nps: 6 }, vars }).redirectUrl, null)
})

test('plantilla de cualificación: temperatura caliente dispara el final prioritario', async () => {
  const { FORM_TEMPLATES } = await import('../lib/forms/templates/index.ts')
  const { evaluateSubmission } = await import('../lib/forms/submission.ts')
  const t = FORM_TEMPLATES.find((x) => x.key === 'cualificacion-cliente')
  const cal = evaluateSubmission(t.config, {
    answers: {
      nombre: 'Ana',
      email: 'a@b.co',
      telefono: '+34600123456',
      situacion: 'autonomo',
      facturacion: '3000+',
      listo: 'yes',
    },
  })
  assert.equal(cal.ok, true)
  assert.equal(cal.score.temperature, 'caliente')
  assert.equal(cal.endingId, 'prioritario')
  const frio = evaluateSubmission(t.config, {
    answers: {
      nombre: 'Ana',
      email: 'a@b.co',
      telefono: '+34600123456',
      situacion: 'otro',
      facturacion: '0-500',
      listo: 'no',
      objecion: 'precio',
    },
  })
  assert.equal(frio.score.temperature, 'frio')
  assert.equal(frio.endingId, 'gracias')
})

test('analítica: visitas aunque no empiecen, embudo por id con abandono por paso, y estrellas', async () => {
  const { computeAnalytics } = await import('../lib/forms/analytics.ts')
  const c = feedback()
  const ses = (status, last, times, extra = {}) => ({
    status,
    device: 'mobile',
    variant: null,
    utm: { source: 'ig', campaign: 'lanza' },
    referrer_host: null,
    last_question: last,
    max_question_index: 0,
    question_times: times,
    created_at: '2026-10-01T10:00:00Z',
    started_at: null,
    completed_at: null,
    ...extra,
  })
  const sessions = [
    ses('viewed', null, {}),
    ses('viewed', null, {}),
    ses('abandoned', 'profe', {}),
    ses('abandoned', 'estrellas', { profe: 1000 }),
    ses('abandoned', 'mejora', { profe: 1000, estrellas: 2000 }),
    ses('completed', 'mejora', { profe: 1000, estrellas: 3000 }, { variant: 'A' }),
  ]
  const resp = (answers, extra = {}) => ({
    status: 'completed',
    answers,
    rating: null,
    nps: null,
    score: null,
    temperature: null,
    outcome: null,
    variant: 'A',
    device: 'mobile',
    duration_ms: 20000,
    created_at: '2026-10-01T10:05:00Z',
    completed_at: '2026-10-01T10:05:00Z',
    ...extra,
  })
  const a = computeAnalytics(c, sessions, [
    resp({ profe: 'a', estrellas: 5 }, { rating: 5, outcome: 'resena' }),
    resp({ profe: 'b', estrellas: 2, mejora: 'más práctica' }, { rating: 2, outcome: 'gracias' }),
  ])
  assert.equal(a.kpis.views, 6)
  assert.equal(a.kpis.starts, 4)
  assert.equal(a.kpis.completions, 2)
  assert.equal(a.kpis.abandonments, 3)
  assert.deepEqual(a.entry, { views: 6, starts: 4, dropped: 2, dropRate: 2 / 6 })
  assert.deepEqual(
    a.funnel.map((f) => f.id),
    ['profe', 'estrellas', 'mejora', 'email']
  )
  const f = Object.fromEntries(a.funnel.map((x) => [x.id, x]))
  assert.deepEqual([f.profe.reached, f.profe.dropped, f.profe.dropRate], [4, 1, 0.25])
  assert.deepEqual([f.estrellas.reached, f.estrellas.dropped], [3, 1])
  assert.equal(f.estrellas.dropRate, 1 / 3)
  assert.deepEqual([f.mejora.reached, f.mejora.dropped], [2, 1])
  assert.equal(f.mejora.dropRate, 0.5)
  assert.equal(f.email.reached, 0)
  assert.equal(f.email.dropRate, null)
  assert.equal(f.profe.pctOfStarts, 1)
  assert.equal(a.biggestDrop.id, 'profe')
  assert.equal(a.rating.average, 3.5)
  assert.deepEqual(a.sources, [{ label: 'ig', count: 6 }])
  assert.equal(a.questions.find((q) => q.id === 'profe').choices.length, 2)
  assert.deepEqual(a.questions.find((q) => q.id === 'mejora').texts, ['más práctica'])
  assert.equal(a.variants[0].variant, 'A')
  assert.deepEqual(a.outcomes.map((o) => o.id).sort(), ['gracias', 'resena'])
  // Un envío completado cuenta aunque su sesión no se registrase.
  assert.equal(computeAnalytics(c, [], [resp({ profe: 'a', estrellas: 5 })]).kpis.completions, 1)
})

test('analítica: con saltos, el embudo cuenta solo las preguntas del camino de cada sesión', async () => {
  const { computeAnalytics } = await import('../lib/forms/analytics.ts')
  const c = feedback() // 5★ salta de "estrellas" al final, sin pasar por "mejora"
  const s = (status, last, times) => ({
    status,
    device: 'desktop',
    variant: null,
    utm: null,
    referrer_host: null,
    last_question: last,
    max_question_index: 0,
    question_times: times,
    created_at: '2026-10-01T10:00:00Z',
    started_at: null,
    completed_at: null,
  })
  const a = computeAnalytics(
    c,
    [
      s('completed', 'estrellas', { profe: 500 }),
      s('completed', 'estrellas', { profe: 500 }),
      s('abandoned', 'mejora', { profe: 500, estrellas: 500 }),
    ],
    []
  )
  const f = Object.fromEntries(a.funnel.map((x) => [x.id, x]))
  assert.equal(f.estrellas.reached, 3)
  assert.equal(f.mejora.reached, 1, 'solo la sesión que sacó <4 estrellas llegó a "mejora"')
  assert.equal(f.mejora.dropRate, 1)
  assert.equal(f.estrellas.dropped, 0, 'completaron tras estrellas: no abandonan ahí')
})

test('analítica: NPS = promotores - detractores', async () => {
  const { computeAnalytics } = await import('../lib/forms/analytics.ts')
  const c = {
    schemaVersion: 1,
    questions: [{ id: 'n', type: 'nps', title: 'NPS', semantic: 'nps' }],
    logic: [],
    endings: [{ id: 'f', title: 'f', isDefault: true }],
  }
  const r = (n) => ({
    status: 'completed',
    answers: { n },
    rating: null,
    nps: n,
    score: null,
    temperature: null,
    outcome: 'f',
    variant: null,
    device: null,
    duration_ms: null,
    created_at: '2026-10-01T00:00:00Z',
    completed_at: '2026-10-01T00:00:00Z',
  })
  const a = computeAnalytics(c, [], [r(10), r(9), r(8), r(3)])
  assert.equal(a.nps.score, 25)
  assert.deepEqual(a.questions[0].nps, { score: 25, promoters: 2, passives: 1, detractors: 1 })
})

test('feedback de alumnos: media, NPS, profesores con tendencia y comentarios de valoraciones bajas', async () => {
  const { computeFeedback } = await import('../lib/forms/feedback.ts')
  const now = Date.parse('2026-10-20T12:00:00Z')
  const d = (days) => new Date(now - days * 86_400_000).toISOString()
  const row = (o) => ({
    form_id: 'f',
    rating: null,
    nps: null,
    teacher: null,
    module: null,
    class_name: null,
    created_at: d(1),
    contact_id: null,
    ...o,
  })
  const s = computeFeedback(
    [
      row({ rating: 5, teacher: 'Ana', created_at: d(2), contact_id: 'c1' }),
      row({ rating: 5, teacher: 'Ana', created_at: d(3) }),
      row({ rating: 2, teacher: 'Ana', created_at: d(40), comment: 'Poco ritmo' }),
      row({ rating: 3, teacher: 'Beto', module: 'Módulo 1', created_at: d(5), comment: 'Falta práctica' }),
      row({ nps: 10 }),
      row({ nps: 9 }),
      row({ nps: 3 }),
      row({ nps: 8 }),
    ],
    now
  )
  assert.equal(s.responses, 8)
  assert.equal(s.linked, 1)
  assert.equal(s.rating.responses, 4)
  assert.equal(s.rating.average, 3.75)
  assert.deepEqual(s.nps, { score: 25, responses: 4, promoters: 2, passives: 1, detractors: 1 })
  const ana = s.teachers.find((t) => t.label === 'Ana')
  assert.equal(ana.responses, 3)
  assert.equal(ana.low, 1)
  assert.equal(ana.trend, 5 - 2)
  assert.equal(s.teachers[0].label, 'Ana')
  assert.equal(s.modules[0].label, 'Módulo 1')
  assert.deepEqual(
    s.lowComments.map((c) => c.comment),
    ['Falta práctica', 'Poco ritmo']
  )
  assert.ok(s.weekly.length >= 1)
})

test('tema: acento propio → variables de marca y texto legible; sin tema hereda la subcuenta', async () => {
  const { themeVars, formVars, textOn, contrastRatio, hexToHslTriplet, isDarkTheme, HEX } =
    await import('../lib/forms/theme.ts')
  assert.deepEqual(hexToHslTriplet('#ff0000'), { h: 0, s: 100, l: 50 })
  assert.equal(hexToHslTriplet('rojo'), null)
  assert.equal(HEX.test('#12abEF'), true)
  assert.equal(HEX.test('#12abE'), false)
  assert.equal(textOn('#ffffff'), '#0a0a0b')
  assert.equal(textOn('#111827'), '#ffffff')
  assert.ok(contrastRatio('#000000', '#ffffff') > 20)
  // Sin tema no se toca la rampa de la subcuenta.
  assert.equal(themeVars(undefined)['--brand-500'], undefined)
  assert.equal(themeVars({ mode: 'auto' })['--brand-500'], undefined)
  const v = themeVars({ mode: 'light', accent: '#7c3aed', radius: 'full', font: 'serif' })
  assert.match(v['--brand-500'], /^\d+ \d+% \d+%$/)
  assert.equal(v['--form-on-accent'], '#ffffff')
  assert.equal(v['--form-button-radius'], '9999px')
  assert.match(v['--form-font'], /Georgia/)
  // Acentos claros reciben texto oscuro (los botones deben leerse).
  assert.equal(themeVars({ mode: 'light', accent: '#facc15' })['--form-on-accent'], '#0a0a0b')
  // Claro explícito aunque el ancestro sea oscuro; fondo oscuro propio fuerza paleta oscura.
  assert.equal(formVars({ mode: 'light' }, true)['--background'], '210 40% 99%')
  assert.equal(formVars({ mode: 'auto' }, true)['--background'], '240 5% 4%')
  assert.equal(isDarkTheme({ mode: 'light', background: '#101010' }, false), true)
  assert.equal(isDarkTheme({ mode: 'dark', background: '#fafafa' }, true), false)
  assert.equal(
    formConfigSchema.safeParse({
      ...feedback(),
      theme: { mode: 'light', accent: '#7c3aed', font: 'serif', radius: 'lg', coverUrl: 'https://a.test/x.jpg' },
    }).success,
    true
  )
  assert.equal(formConfigSchema.safeParse({ ...feedback(), theme: { mode: 'light', accent: 'rojo' } }).success, false)
  assert.equal(
    formConfigSchema.safeParse({ ...feedback(), theme: { mode: 'light', logoUrl: 'javascript:alert(1)' } }).success,
    false
  )
  assert.equal(
    formConfigSchema.safeParse({ ...feedback(), theme: { mode: 'light', coverUrl: 'http://a.test/x.jpg' } }).success,
    false
  )
})

// --- Lógica tipo Typeform: orden, "en cualquier otro caso" y puntuación numérica ---
const logicCfg = (logic, extra = {}) => ({
  schemaVersion: 1,
  questions: [
    {
      id: 'q1',
      type: 'singleChoice',
      title: 'P1',
      required: true,
      options: [
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B' },
      ],
    },
    { id: 'q2', type: 'shortText', title: 'P2', required: false },
    { id: 'q3', type: 'shortText', title: 'P3', required: false },
    { id: 'q4', type: 'nps', title: 'P4', required: false },
  ],
  endings: [
    { id: 'fin', title: 'Fin', isDefault: true },
    { id: 'descarte', title: 'Descarte' },
  ],
  logic,
  ...extra,
})
const cond = (v) => ({ match: 'all', conditions: [{ questionId: 'q1', op: 'equals', value: v }] })
const sinCond = { match: 'all', conditions: [] }

test('lógica: gana la primera regla que cumple y el orden importa', () => {
  const rules = [
    { id: 'r1', from: 'q1', when: cond('a'), then: { type: 'jump', target: 'q3' } },
    { id: 'r2', from: 'q1', when: cond('a'), then: { type: 'end', endingId: 'descarte' } },
  ]
  assert.deepEqual(nextStep(logicCfg(rules), 'q1', { q1: 'a' }), { kind: 'question', id: 'q3' })
  assert.deepEqual(nextStep(logicCfg([...rules].reverse()), 'q1', { q1: 'a' }), { kind: 'ending', id: 'descarte' })
})

test('lógica: "en cualquier otro caso" (regla sin condición, la última) solo aplica si nada más cumple', () => {
  const rules = [
    { id: 'r1', from: 'q1', when: cond('a'), then: { type: 'jump', target: 'q3' } },
    { id: 'otro', from: 'q1', when: sinCond, then: { type: 'end', endingId: 'descarte' } },
  ]
  assert.deepEqual(nextStep(logicCfg(rules), 'q1', { q1: 'a' }), { kind: 'question', id: 'q3' })
  assert.deepEqual(nextStep(logicCfg(rules), 'q1', { q1: 'b' }), { kind: 'ending', id: 'descarte' })
})

test('lógica: sin regla aplicable sigue a la siguiente pregunta y los saltos hacia atrás se ignoran', () => {
  const rules = [{ id: 'r1', from: 'q3', when: sinCond, then: { type: 'jump', target: 'q1' } }]
  assert.deepEqual(nextStep(logicCfg(rules), 'q3', {}), { kind: 'question', id: 'q4' })
  assert.deepEqual(nextStep(logicCfg([]), 'q1', { q1: 'b' }), { kind: 'question', id: 'q2' })
})

test('scoring: los pesos numéricos (gte/lte) puntúan número, NPS o valoración', () => {
  const scoring = {
    enabled: true,
    weights: [
      { questionId: 'q4', gte: 9, points: 40 },
      { questionId: 'q4', gte: 7, lte: 8, points: 20 },
      { questionId: 'q4', lte: 6, points: 0 },
    ],
    thresholds: { caliente: 40, templado: 20 },
  }
  const c = logicCfg([], { scoring })
  assert.equal(computeScore(c, { q4: 10 }).temperature, 'caliente')
  assert.equal(computeScore(c, { q4: 7 }).temperature, 'templado')
  assert.equal(computeScore(c, { q4: 3 }).temperature, 'frio')
  assert.equal(computeScore(c, { q4: 'abc' }).score, 0)
  assert.equal(formConfigSchema.safeParse(c).success, true)
})

test('semántica: rating/nps fuera de rango no llegan a la BD (no tumban el envío)', () => {
  const c = {
    questions: [
      { id: 'a', type: 'number', semantic: 'rating' },
      { id: 'b', type: 'number', semantic: 'nps' },
    ],
  }
  assert.equal(extractSemantic(c, { a: 0, b: 11 }).rating, null)
  assert.equal(extractSemantic(c, { a: 3.4, b: 0 }).rating, 3)
  assert.equal(extractSemantic(c, { a: 3, b: 0 }).nps, 0)
})
