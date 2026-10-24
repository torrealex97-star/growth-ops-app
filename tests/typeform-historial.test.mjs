import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { cargarHistorialTypeform, codificarCursor, decodificarCursor } from '../lib/typeform/historial.ts'
import { baseTypeform, comoPayloadDeWebhook, crearClienteTypeform } from '../lib/typeform/api.ts'

// Base en memoria mínima: comprueba el FLUJO (qué se escribe y qué no), no RLS ni constraints.
class Q {
  constructor(db, t) {
    Object.assign(this, { db, t, f: [], op: 'select', payload: null, opts: null, lim: null })
  }
  select() {
    return this
  }
  insert(v) {
    this.op = 'insert'
    this.payload = v
    return this
  }
  upsert(v, o) {
    this.op = 'upsert'
    this.payload = v
    this.opts = o
    return this
  }
  update(v) {
    this.op = 'update'
    this.payload = v
    return this
  }
  eq(c, v) {
    this.f.push((r) => r[c] === v)
    return this
  }
  is(c, v) {
    this.f.push((r) => (r[c] ?? null) === v)
    return this
  }
  in(c, a) {
    this.f.push((r) => a.includes(r[c]))
    return this
  }
  contains(c, o) {
    this.f.push((r) => Object.entries(o).every(([k, arr]) => arr.every((x) => (r[c]?.[k] ?? []).includes(x))))
    return this
  }
  limit(n) {
    this.lim = n
    return this
  }
  maybeSingle() {
    this.uno = 'maybe'
    return this
  }
  single() {
    this.uno = 'one'
    return this
  }
  then(res, rej) {
    return Promise.resolve(this.exec()).then(res, rej)
  }
  exec() {
    const tabla = (this.db[this.t] ??= [])
    const coincide = (r) => this.f.every((fn) => fn(r))
    let filas
    if (this.op === 'insert' || this.op === 'upsert') {
      filas = []
      for (const v of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const n = { id: crypto.randomUUID(), ...v }
        const claves = this.opts?.onConflict?.split(',')
        const previa = claves && tabla.find((r) => claves.every((k) => r[k] === n[k]))
        if (previa && this.op === 'upsert') {
          if (!this.opts.ignoreDuplicates) Object.assign(previa, n, { id: previa.id })
          filas.push(previa)
        } else {
          tabla.push(n)
          filas.push(n)
        }
      }
    } else if (this.op === 'update') {
      filas = tabla.filter(coincide)
      for (const r of filas) Object.assign(r, this.payload)
    } else {
      filas = tabla.filter(coincide)
      if (this.lim != null) filas = filas.slice(0, this.lim)
    }
    if (this.uno) return { data: filas[0] ?? null, error: null }
    return { data: filas, error: null }
  }
}
const fakeSb = (db) => ({
  from: (t) => new Q(db, t),
  rpc: () => {
    throw new Error('rpc no esperado: no se deben crear contactos')
  },
})

const definicion = {
  title: 'Cualificación',
  fields: [
    { id: 'f1', type: 'email', title: 'Email' },
    { id: 'f2', type: 'short_text', title: '¿Cuál es tu situación?' },
  ],
}
const respuesta = (token, email, situacion, minutos = 0) => ({
  token,
  submitted_at: new Date(Date.UTC(2026, 9, 20, 10, minutos)).toISOString(),
  hidden: {},
  answers: [
    { type: 'email', email, field: { id: 'f1', type: 'email' } },
    { type: 'text', text: situacion, field: { id: 'f2', type: 'short_text' } },
  ],
})
const clienteFalso = (porForm, { onLeer } = {}) => ({
  listarFormularios: async () =>
    Object.keys(porForm)
      .sort()
      .map((id) => ({ id, titulo: id })),
  leerDefinicion: async () => definicion,
  leerRespuestas: async (formId, { antesDe }) => {
    onLeer?.(formId, antesDe)
    const todas = porForm[formId]
    const i = antesDe ? todas.findIndex((x) => x.token === antesDe) + 1 : 0
    return { items: todas.slice(i, i + 100), total: todas.length }
  },
})
const ESCENARIO = (extra = {}) => ({
  contacts: [
    {
      id: 'c1',
      tenant_id: 'T',
      email: 'ana@x.com',
      email_normalized: 'ana@x.com',
      merged_into: null,
      qualification: null,
    },
  ],
  appointments: [{ id: 'a1', tenant_id: 'T', contact_id: 'c1', status: 'scheduled', qualification: null }],
  ...extra,
})

test('el histórico encaja la respuesta con el contacto, la copia a su agenda y NO crea contactos', async () => {
  const db = ESCENARIO()
  const r = await cargarHistorialTypeform({
    sb: fakeSb(db),
    tenantId: 'T',
    cfg: {},
    cliente: clienteFalso({ F1: [respuesta('t1', 'ana@x.com', 'Autónoma'), respuesta('t2', 'nadie@x.com', 'Otra')] }),
  })
  assert.equal(r.procesadas, 2)
  assert.equal(r.encajadas, 1)
  assert.equal(r.sinContacto, 1)
  assert.equal(r.siguiente, null)
  assert.equal(db.contacts.length, 1, 'no se crean contactos con fecha antigua')
  assert.equal(db.appointments[0].qualification.respuestas.length, 2)
  assert.equal(db.contacts[0].qualification.origen, 'typeform')
  // La que no encaja queda guardada para enlazarla a mano.
  assert.equal(db.raw_events.filter((e) => e.source === 'typeform').length, 2)
})

test('repetir el histórico es idempotente: lo ya normalizado no se reprocesa', async () => {
  const db = ESCENARIO()
  const cliente = clienteFalso({ F1: [respuesta('t1', 'ana@x.com', 'Autónoma')] })
  await cargarHistorialTypeform({ sb: fakeSb(db), tenantId: 'T', cfg: {}, cliente })
  const r2 = await cargarHistorialTypeform({ sb: fakeSb(db), tenantId: 'T', cfg: {}, cliente })
  assert.equal(r2.yaProcesadas, 1)
  assert.equal(r2.procesadas, 0)
  assert.equal(db.raw_events.length, 1)
})

test('sin presupuesto de tiempo devuelve un cursor que reanuda en el mismo formulario', async () => {
  const db = ESCENARIO()
  let t = 0
  const cliente = clienteFalso({ F1: [respuesta('t1', 'ana@x.com', 'a')], F2: [respuesta('t2', 'ana@x.com', 'b')] })
  const r = await cargarHistorialTypeform({
    sb: fakeSb(db),
    tenantId: 'T',
    cfg: {},
    cliente,
    presupuestoMs: 10,
    ahora: () => (t += 20), // cada consulta del reloj avanza más que el presupuesto
  })
  assert.ok(r.siguiente, 'queda trabajo por hacer')
  const c = decodificarCursor(codificarCursor(r.siguiente))
  assert.equal(c.form, r.siguiente.form)
  const r2 = await cargarHistorialTypeform({ sb: fakeSb(db), tenantId: 'T', cfg: {}, cliente, cursor: c })
  assert.equal(r2.siguiente, null)
})

test('el teléfono compartido o el email repetido no se adivinan', async () => {
  const db = ESCENARIO({
    contacts: [
      { id: 'c1', tenant_id: 'T', email: 'a@x.com', email_normalized: 'dup@x.com', merged_into: null },
      { id: 'c2', tenant_id: 'T', email: 'b@x.com', email_normalized: 'dup@x.com', merged_into: null },
    ],
    appointments: [],
  })
  const r = await cargarHistorialTypeform({
    sb: fakeSb(db),
    tenantId: 'T',
    cfg: {},
    cliente: clienteFalso({ F1: [respuesta('t1', 'dup@x.com', 'a')] }),
  })
  assert.equal(r.encajadas, 0)
  assert.equal(r.sinContacto, 1)
})

test('el cursor inválido o manipulado se ignora', () => {
  assert.equal(decodificarCursor('no-es-base64-json'), null)
  assert.equal(decodificarCursor(null), null)
})

test('API de Typeform: región EU, forma del webhook y error claro con token malo', async () => {
  assert.equal(baseTypeform('EU'), 'https://api.eu.typeform.com')
  assert.equal(baseTypeform(''), 'https://api.typeform.com')
  const p = comoPayloadDeWebhook({ token: 'tk', answers: [] }, 'F1', definicion)
  assert.equal(p.event_id, 'tk')
  assert.equal(p.form_response.form_id, 'F1')
  assert.equal(p.form_response.definition.title, 'Cualificación')
  const malo = crearClienteTypeform('tok', { fetchImpl: async () => new Response('{}', { status: 401 }) })
  await assert.rejects(malo.listarFormularios(), /rechazó el token/)
})
