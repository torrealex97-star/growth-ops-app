import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { verificarFirmaTypeform } from '../lib/webhooks/typeform.ts'
import {
  fusionarCualificacion,
  listaFormulariosFeedback,
  normalizarRespuestaTypeform,
  propositoDe,
} from '../lib/typeform/respuesta.ts'

const firmar = (raw, secreto) => `sha256=${crypto.createHmac('sha256', secreto).update(raw).digest('base64')}`
const cab = (valor) => new Headers(valor ? { 'typeform-signature': valor } : {})

test('firma: válida con el secreto, rechazada con otro, sin cabecera o sin secreto', () => {
  const raw = '{"a":1}'
  assert.equal(verificarFirmaTypeform(raw, cab(firmar(raw, 's3cret')), 's3cret').valida, true)
  assert.equal(verificarFirmaTypeform(raw, cab(firmar(raw, 'otro')), 's3cret').valida, false)
  assert.equal(verificarFirmaTypeform(raw, cab(), 's3cret').valida, false)
  assert.equal(verificarFirmaTypeform(raw, cab(firmar(raw, 's3cret')), undefined).valida, false)
  // El cuerpo manda: un byte distinto invalida la firma.
  assert.equal(verificarFirmaTypeform('{"a":2}', cab(firmar(raw, 's3cret')), 's3cret').valida, false)
  assert.equal(verificarFirmaTypeform(raw, cab('abc'), 's3cret').valida, false)
})

const campo = (id, type, title) => ({ id, type, title, ref: id })
const payload = (extra = {}) => ({
  event_id: 'evt1',
  event_type: 'form_response',
  form_response: {
    form_id: 'F1',
    token: 'tok1',
    submitted_at: '2026-10-18T10:00:00Z',
    hidden: { utm_source: 'ig', utm_medium: 'paid', ...(extra.hidden || {}) },
    definition: {
      title: 'Aplicación',
      fields: [
        campo('a', 'short_text', 'Nombre'),
        campo('b', 'short_text', 'Apellidos'),
        campo('c', 'email', 'Tu email'),
        campo('d', 'phone_number', 'WhatsApp'),
        campo('e', 'short_text', '¿Cuánto estás generando al mes?'),
        campo('f', 'opinion_scale', 'Del 0 al 10, ¿nos recomendarías?'),
        campo('g', 'rating', 'Valora la clase'),
      ],
    },
    answers: [
      { type: 'text', text: 'Laura', field: { id: 'a', type: 'short_text' } },
      { type: 'text', text: 'Gómez', field: { id: 'b', type: 'short_text' } },
      { type: 'email', email: 'Laura@Ejemplo.COM', field: { id: 'c', type: 'email' } },
      { type: 'phone_number', phone_number: '+34 600 111 222', field: { id: 'd', type: 'phone_number' } },
      { type: 'text', text: '1500', field: { id: 'e', type: 'short_text' } },
      ...(extra.answers || []),
    ],
  },
})

test('parser: identidad por tipo de respuesta, cualificación como Calendly y atribución desde campos ocultos', () => {
  const r = normalizarRespuestaTypeform(payload())
  assert.equal(r.token, 'tok1')
  assert.equal(r.formId, 'F1')
  assert.equal(r.email, 'laura@ejemplo.com')
  assert.equal(r.telefono, '+34600111222')
  assert.equal(r.nombre, 'Laura')
  assert.equal(r.apellidos, 'Gómez')
  assert.equal(r.proposito, 'lead')
  assert.equal(r.cualificacion.ingresos, '1500')
  assert.equal(r.respuestas.length, 5)
  assert.equal(r.cualificacion.origen, 'typeform')
  assert.deepEqual(r.ocultos, { utm_source: 'ig', utm_medium: 'paid' })
  assert.equal(r.nota, null)
})

test('parser: la nota sale de opinion_scale y rating (rating 1-5 se lleva a 0-10)', () => {
  const op = normalizarRespuestaTypeform(
    payload({ answers: [{ type: 'number', number: 9, field: { id: 'f', type: 'opinion_scale' } }] })
  )
  assert.equal(op.nota, 9)
  const ra = normalizarRespuestaTypeform(
    payload({ answers: [{ type: 'number', number: 4, field: { id: 'g', type: 'rating' } }] })
  )
  assert.equal(ra.nota, 8)
})

test('parser: sin email ni teléfono quedan a null (no se inventa identidad) y un cuerpo ajeno no es respuesta', () => {
  const p = payload()
  p.form_response.answers = [{ type: 'text', text: 'Laura', field: { id: 'a', type: 'short_text' } }]
  const r = normalizarRespuestaTypeform(p)
  assert.equal(r.email, null)
  assert.equal(r.telefono, null)
  assert.equal(normalizarRespuestaTypeform({ hola: 1 }), null)
  assert.equal(normalizarRespuestaTypeform(null), null)
  assert.equal(normalizarRespuestaTypeform({ form_response: { form_id: 'F1' } }), null)
})

test('propósito: el campo oculto manda sobre la lista de ids; por defecto es cualificación', () => {
  assert.equal(propositoDe({}, 'F1', []), 'lead')
  assert.equal(propositoDe({}, 'F1', ['F1']), 'feedback')
  assert.equal(propositoDe({ purpose: 'feedback' }, 'F1', []), 'feedback')
  assert.equal(propositoDe({ tipo: 'FEEDBACK' }, 'F1', []), 'feedback')
  assert.equal(propositoDe({ purpose: 'lead' }, 'F1', ['F1']), 'lead')
  assert.deepEqual(listaFormulariosFeedback('a1, b2;c3\nd4'), ['a1', 'b2', 'c3', 'd4'])
  assert.deepEqual(listaFormulariosFeedback(undefined), [])
})

test('fusión: lo nuevo gana en sus claves, se conserva lo anterior y las preguntas no se repiten', () => {
  const previa = {
    ingresos: '500',
    instagram: 'laura',
    respuestas: [
      { q: 'Ingresos', a: '500' },
      { q: 'Instagram', a: 'laura' },
    ],
  }
  const nueva = { ingresos: '1500', respuestas: [{ q: 'ingresos', a: '1500' }] }
  const f = fusionarCualificacion(previa, nueva)
  assert.equal(f.ingresos, '1500')
  assert.equal(f.instagram, 'laura')
  assert.deepEqual(f.respuestas, [
    { q: 'Instagram', a: 'laura' },
    { q: 'ingresos', a: '1500' },
  ])
  assert.equal(fusionarCualificacion(null, nueva).ingresos, '1500')
})

test('el webhook no crea contactos para feedback y escribe el sobre antes de procesar', () => {
  const e = readFileSync('lib/typeform/entrada.ts', 'utf8')
  assert.match(e, /respuesta\.proposito === 'lead'\s*\?\s*await proyectarLead\(.*\)\s*:\s*await buscarContacto/s)
  assert.ok(e.indexOf(".from('raw_events')\n    .upsert") < e.indexOf('proyectarLead(sb'), 'sobre antes de proyectar')
  assert.match(e, /type: 'revision'/)
  assert.match(e, /leadChannel: 'typeform'/)
})

test('la integración está en el catálogo y la migración hereda la cualificación solo cuando falta', () => {
  const c = readFileSync('lib/integrations-catalog.ts', 'utf8')
  assert.match(c, /id: 'typeform'/)
  assert.match(c, /TYPEFORM_WEBHOOK_SECRET/)
  const sql = readFileSync('supabase/migrations/20261018100000_appointments_heredar_cualificacion.sql', 'utf8')
  assert.match(sql, /BEFORE INSERT ON public\.appointments/)
  assert.match(sql, /jsonb_array_length\(NEW\.qualification -> 'respuestas'\) > 0 THEN\s+RETURN NEW/)
  assert.match(sql, /c\.tenant_id = NEW\.tenant_id/)
})
