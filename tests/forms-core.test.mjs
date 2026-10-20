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
