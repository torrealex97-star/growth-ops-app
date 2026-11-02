import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PALANCAS, construirBriefing } from '../lib/closer/briefing.ts'
import { TEMAS } from '../lib/insights/voz-cliente.ts'

test('sin ningún dato no hay briefing (no se pinta una ficha vacía)', () => {
  const b = construirBriefing({ respuestas: [] })
  assert.equal(b.conDatos, false)
  assert.deepEqual(b.palancas, [])
  assert.equal(construirBriefing({ respuestas: [{ pregunta: 'x', respuesta: '' }] }).conDatos, false)
})

test('las palancas salen de lo que la persona escribió y citan por qué', () => {
  const b = construirBriefing({
    respuestas: [
      { pregunta: '¿Qué te frena?', respuesta: 'No tengo tiempo y el dinero está justo' },
      { pregunta: 'Edad', respuesta: '34' },
    ],
    anuncio: 'Comparación pizarra',
    campana: 'Lanz oct',
    leadNivel: 'alto',
  })
  assert.deepEqual(b.palancas.map((p) => p.temaId).sort(), ['dinero', 'tiempo'])
  assert.ok(b.palancas.every((p) => p.palanca.length > 20 && /formulario/.test(p.porQue)))
  assert.deepEqual(b.angulo, { anuncio: 'Comparación pizarra', campana: 'Lanz oct' })
  assert.equal(b.leadNivel, 'alto')
})

test('una objeción previa se marca como tal y suma su tema aunque el formulario no lo diga', () => {
  const b = construirBriefing({
    respuestas: [{ pregunta: 'Objetivo', respuesta: 'Quiero mejorar mi situación' }],
    objecionesPrevias: ['Teme que sea una estafa', '  '],
  })
  const conf = b.palancas.find((p) => p.temaId === 'confianza')
  assert.ok(conf)
  assert.match(conf.porQue, /llamada anterior/)
  assert.deepEqual(b.objeccionesPrevias, ['Teme que sea una estafa'])
})

test('todo tema de la taxonomía tiene una palanca (ninguno queda sin qué hacer)', () => {
  for (const t of TEMAS) assert.ok(PALANCAS[t.id], `falta palanca para ${t.id}`)
})

test('el briefing se calcula con lo que ya hay en la cita y no hace consultas nuevas', () => {
  const comp = readFileSync('components/appointments/BriefingCloser.tsx', 'utf8')
  assert.doesNotMatch(comp, /fetch\(|supabase/)
  const det = readFileSync('components/appointments/AppointmentDetail.tsx', 'utf8')
  assert.match(det, /<BriefingCloser/)
})
