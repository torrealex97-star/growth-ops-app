import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { procesarEntradaTypeform } from '../lib/typeform/entrada.ts'

// Base de datos en memoria con la forma mínima del cliente de Supabase que usa el motor. No simula
// RLS ni restricciones: comprueba el FLUJO (qué se escribe, qué no y qué pasa en un reintento).
class Q {
  constructor(db, t) {
    Object.assign(this, { db, t, f: [], op: 'select', payload: null, opts: null, lim: null, uno: null })
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
  ilike(c, v) {
    this.f.push((r) => String(r[c] ?? '').toLowerCase() === String(v).toLowerCase())
    return this
  }
  like(c, p) {
    const pre = String(p).replace(/%$/, '')
    this.f.push((r) => String(r[c] ?? '').startsWith(pre))
    return this
  }
  in(c, a) {
    this.f.push((r) => a.includes(r[c]))
    return this
  }
  not() {
    return this
  }
  order() {
    return this
  }
  range() {
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
      const nuevas = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((v) => ({
        id: crypto.randomUUID(),
        ...v,
      }))
      filas = []
      for (const n of nuevas) {
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

function cliente(db) {
  return {
    from: (t) => new Q(db, t),
    rpc: (nombre, a) => {
      assert.equal(nombre, 'contacts_get_or_create')
      const contactos = (db.contacts ??= [])
      const email = a.p_email?.toLowerCase() ?? null
      let c = contactos.find(
        (x) => x.tenant_id === a.p_tenant_id && ((email && x.email === email) || (a.p_phone && x.phone === a.p_phone))
      )
      let created = false
      if (!c) {
        c = {
          id: crypto.randomUUID(),
          tenant_id: a.p_tenant_id,
          email,
          phone: a.p_phone,
          full_name: a.p_full_name,
          lead_channel: a.p_lead_channel,
          instagram: a.p_instagram,
          age: a.p_age,
          ghl_contact_id: null,
        }
        contactos.push(c)
        created = true
      }
      return { select: () => ({ maybeSingle: async () => ({ data: { ...c, created }, error: null }) }) }
    },
  }
}

const TENANT = 'tenant-1'
const SECRETO = 'secreto-de-prueba'
const firmar = (raw) => `sha256=${crypto.createHmac('sha256', SECRETO).update(raw).digest('base64')}`

function entorno(extra = {}) {
  const db = {
    tenants: [{ id: TENANT, slug: 'wdc', status: 'active' }],
    contacts: [],
    appointments: [],
    ...extra,
  }
  return { db, cl: cliente(db) }
}

const cuerpo = (token, { hidden = {}, extra = [] } = {}) => ({
  event_id: `e-${token}`,
  event_type: 'form_response',
  form_response: {
    form_id: 'F1',
    token,
    submitted_at: '2026-10-18T10:00:00Z',
    hidden,
    definition: {
      title: 'Aplicación',
      fields: [
        { id: 'a', type: 'short_text', title: 'Nombre', ref: 'a' },
        { id: 'c', type: 'email', title: 'Email', ref: 'c' },
        { id: 'e', type: 'short_text', title: '¿Cuánto estás generando al mes?', ref: 'e' },
        { id: 'f', type: 'opinion_scale', title: 'Nota', ref: 'f' },
      ],
    },
    answers: [
      { type: 'text', text: 'Laura', field: { id: 'a', type: 'short_text' } },
      { type: 'email', email: 'Laura@Ejemplo.com', field: { id: 'c', type: 'email' } },
      { type: 'text', text: '1500', field: { id: 'e', type: 'short_text' } },
      ...extra,
    ],
  },
})

async function enviar(env, payload, { secreto = SECRETO, config = { TYPEFORM_WEBHOOK_SECRET: SECRETO } } = {}) {
  const raw = JSON.stringify(payload)
  const firma = secreto === SECRETO ? firmar(raw) : 'sha256=mala'
  const req = new Request('http://x/api/wdc/evergreen/webhooks/typeform', {
    method: 'POST',
    headers: { 'typeform-signature': firma },
    body: raw,
  })
  const res = await procesarEntradaTypeform({
    req,
    params: Promise.resolve({ tenant: 'wdc' }),
    pruebas: { cliente: env.cl, config },
  })
  return { status: res.status, cuerpo: await res.json() }
}

test('firma inválida: 401, rastro del rechazo sin cuerpo y nada se proyecta', async () => {
  const env = entorno()
  const r = await enviar(env, cuerpo('t1'), { secreto: 'otro' })
  assert.equal(r.status, 401)
  assert.equal(env.db.contacts.length, 0)
  assert.equal(env.db.raw_events.length, 1)
  assert.equal(env.db.raw_events[0].processing_status, 'rejected')
  assert.deepEqual(env.db.raw_events[0].payload, { _firma_rechazada: true })
})

test('sin secreto guardado se rechaza todo (fail-closed)', async () => {
  const env = entorno()
  const r = await enviar(env, cuerpo('t1'), { config: {} })
  assert.equal(r.status, 401)
  assert.equal(env.db.contacts.length, 0)
})

test('lead: crea el contacto, guarda la cualificación y la copia a sus agendas sin pisar lo que ya contestó', async () => {
  const env = entorno()
  // Agenda existente sin respuestas, otra con las suyas (Calendly) y una cancelada.
  env.db.contacts.push({ id: 'c0', tenant_id: TENANT, email: 'laura@ejemplo.com', phone: null })
  env.db.appointments.push(
    { id: 'a-vacia', tenant_id: TENANT, contact_id: 'c0', status: 'scheduled', qualification: null },
    {
      id: 'a-propia',
      tenant_id: TENANT,
      contact_id: 'c0',
      status: 'scheduled',
      qualification: { ingresos: '800', respuestas: [{ q: 'Ingresos', a: '800' }] },
    },
    { id: 'a-cancelada', tenant_id: TENANT, contact_id: 'c0', status: 'cancelled', qualification: null }
  )
  const r = await enviar(env, cuerpo('t2', { hidden: { utm_source: 'ig', utm_medium: 'paid' } }))
  assert.equal(r.status, 200)
  assert.equal(r.cuerpo.proposito, 'lead')
  assert.equal(r.cuerpo.contacto, true)
  // Encajó con el contacto existente por email (mayúsculas distintas): no se creó otro.
  assert.equal(env.db.contacts.length, 1)
  assert.equal(env.db.contacts[0].qualification.ingresos, '1500')
  const cita = (id) => env.db.appointments.find((a) => a.id === id)
  assert.equal(cita('a-vacia').qualification.ingresos, '1500')
  // La agenda manda en lo que ya dijo; Typeform solo rellena lo que no estaba.
  assert.equal(cita('a-propia').qualification.ingresos, '800')
  assert.ok(cita('a-propia').qualification.respuestas.length >= 2)
  assert.equal(cita('a-cancelada').qualification, null)
  // Atribución desde los campos ocultos y hecho canónico sin datos personales.
  assert.equal(env.db.contact_attributions[0].utm_source, 'ig')
  const hecho = env.db.canonical_events[0]
  assert.equal(hecho.event_name, 'typeform.formulario.enviado')
  assert.equal(hecho.contact_id, 'c0')
  assert.ok(!JSON.stringify(hecho.properties).includes('ejemplo'))
})

test('persona nueva: se crea como lead con canal typeform', async () => {
  const env = entorno()
  const r = await enviar(env, cuerpo('t3'))
  assert.equal(r.status, 200)
  assert.equal(env.db.contacts.length, 1)
  assert.equal(env.db.contacts[0].lead_channel, 'typeform')
  assert.equal(env.db.contacts[0].email, 'laura@ejemplo.com')
})

test('un reintento del mismo envío no duplica nada', async () => {
  const env = entorno()
  const a = await enviar(env, cuerpo('t4'))
  const b = await enviar(env, cuerpo('t4'))
  assert.equal(a.cuerpo.duplicado, false)
  assert.equal(b.cuerpo.duplicado, true)
  assert.equal(env.db.contacts.length, 1)
  assert.equal(env.db.raw_events.length, 1)
  assert.equal(env.db.canonical_events.length, 1)
})

test('feedback de alguien desconocido: no se crea ningún contacto y el envío queda guardado', async () => {
  const env = entorno()
  const r = await enviar(env, cuerpo('t5', { hidden: { purpose: 'feedback' } }))
  assert.equal(r.status, 200)
  assert.equal(r.cuerpo.proposito, 'feedback')
  assert.equal(r.cuerpo.contacto, false)
  assert.equal(env.db.contacts.length, 0)
  assert.equal(env.db.raw_events.length, 1)
  assert.equal(env.db.raw_events[0].processing_status, 'normalized')
})

test('feedback de una alumna conocida: evento de CSM con su nota, sin tocar su cualificación y sin duplicar', async () => {
  const env = entorno()
  env.db.contacts.push({ id: 'al', tenant_id: TENANT, email: 'laura@ejemplo.com', phone: null, qualification: null })
  const nota = [{ type: 'number', number: 9, field: { id: 'f', type: 'opinion_scale' } }]
  const payload = cuerpo('t6', { hidden: { purpose: 'feedback' }, extra: nota })
  await enviar(env, payload)
  await enviar(env, payload)
  assert.equal(env.db.csm_events.length, 1)
  assert.equal(env.db.csm_events[0].contact_id, 'al')
  assert.equal(env.db.csm_events[0].grade, 9)
  assert.equal(env.db.csm_events[0].type, 'revision')
  assert.equal(env.db.contacts[0].qualification, null)
  assert.equal(env.db.contacts.length, 1)
})

test('feedback por formulario listado en TYPEFORM_FEEDBACK_FORMS aunque no lleve campo oculto', async () => {
  const env = entorno()
  const r = await enviar(env, cuerpo('t7'), {
    config: { TYPEFORM_WEBHOOK_SECRET: SECRETO, TYPEFORM_FEEDBACK_FORMS: 'F1, F9' },
  })
  assert.equal(r.cuerpo.proposito, 'feedback')
  assert.equal(env.db.contacts.length, 0)
})

test('el código de colaboradora en el campo oculto ref atribuye el lead a su perfil', async () => {
  const env = entorno({ collaborator_profiles: [{ id: 'cp1', tenant_id: TENANT, code: 'WDC-0472', status: 'active' }] })
  await enviar(env, cuerpo('t8', { hidden: { ref: 'WDC-0472' } }))
  assert.equal(env.db.contact_attributions[0].collaborator_id, 'cp1')
})

test('sin email ni teléfono no se inventa a nadie: el sobre queda guardado', async () => {
  const env = entorno()
  const p = cuerpo('t9')
  p.form_response.answers = [{ type: 'text', text: 'Laura', field: { id: 'a', type: 'short_text' } }]
  const r = await enviar(env, p)
  assert.equal(r.status, 200)
  assert.equal(r.cuerpo.contacto, false)
  assert.equal(env.db.contacts.length, 0)
  assert.equal(env.db.raw_events.length, 1)
})
