import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { aliasDeContacto, conAlias, emailsDeContacto, sugerirContactos } from '../lib/sales/identidad-pago.ts'
import { pendingPayments } from '../lib/sales/payment-inbox.ts'

const c = (id, email, full_name, custom_fields) => ({ id, email, full_name, custom_fields })
const pago = (extra = {}) => ({
  payment_id: 'pi_1',
  charge_id: 'ch_1',
  customer_id: 'cus_1',
  customer_email: 'trabajo@empresa.test',
  amount: 1000,
  refunded_amount: 0,
  currency: 'eur',
  status: 'succeeded',
  paid_at: '2026-10-15T10:00:00Z',
  ...extra,
})

test('alias: el contacto se reconoce por su correo principal y por los alternativos recordados', () => {
  const x = c('a', 'Laura@Casa.test', 'Laura', {
    emails_alternativos: ['Trabajo@Empresa.test', 'trabajo@empresa.test', 7],
  })
  assert.deepEqual(aliasDeContacto(x), ['trabajo@empresa.test'])
  assert.deepEqual(emailsDeContacto(x), ['laura@casa.test', 'trabajo@empresa.test'])
  assert.deepEqual(emailsDeContacto(c('b', null, 'Sin correo', null)), [])
})

test('conAlias: añade sin pisar otros campos y devuelve null si no hay nada que cambiar', () => {
  const x = c('a', 'laura@casa.test', 'Laura', { otro: 1 })
  const r = conAlias(x, ' Trabajo@Empresa.test ')
  assert.deepEqual(r, { otro: 1, emails_alternativos: ['trabajo@empresa.test'] })
  assert.equal(conAlias(x, 'LAURA@casa.test'), null, 'ya es el principal')
  assert.equal(conAlias({ ...x, custom_fields: r }, 'trabajo@empresa.test'), null, 'ya estaba')
  assert.equal(conAlias(x, 'no-es-un-correo'), null)
  assert.equal(conAlias(x, null), null)
})

test('la bandeja encaja por el correo alternativo y lo dice; sin alias el cobro queda sin contacto', () => {
  const sin = pendingPayments([pago()], [c('a', 'laura@casa.test', 'Laura Gómez', null)], new Set(), null)
  assert.equal(sin[0].contactId, null)
  const con = pendingPayments(
    [pago()],
    [c('a', 'laura@casa.test', 'Laura Gómez', { emails_alternativos: ['trabajo@empresa.test'] })],
    new Set(),
    null
  )
  assert.equal(con[0].contactId, 'a')
  assert.equal(con[0].identitySource, 'alias')
})

test('si dos contactos comparten el alias no se adivina: queda sin contacto', () => {
  const alias = { emails_alternativos: ['trabajo@empresa.test'] }
  const r = pendingPayments([pago()], [c('a', 'a@x.test', 'A', alias), c('b', 'b@x.test', 'B', alias)], new Set(), null)
  assert.equal(r[0].contactId, null)
})

test('el cliente de Stripe vinculado a mano manda y trae el nombre del cliente', () => {
  const r = pendingPayments([pago()], [c('a', 'laura@casa.test', 'Laura Gómez', null)], new Set(), null, [
    { stripe_customer_id: 'cus_1', contact_id: 'a', name: 'Laura G.' },
  ])
  assert.equal(r[0].contactId, 'a')
  assert.equal(r[0].identitySource, 'customer')
  assert.equal(r[0].customerName, 'Laura G.')
})

const hoy = '2026-10-15T10:00:00Z'
const llamada = (contact_id, dias, status = 'show') => ({
  contact_id,
  status,
  appointment_datetime: new Date(Date.parse(hoy) - dias * 86_400_000).toISOString(),
})

test('sugerencias: errata de correo, mismo usuario en otro dominio y mismo nombre, con razones', () => {
  const contactos = [
    c('errata', 'laura.gomez@gmial.test', 'Otra Persona'),
    c('dominio', 'trabajo@casa.test', 'Alguien'),
    c('nombre', 'otro@x.test', 'Laura Gómez'),
    c('ruido', 'zzz@x.test', 'Pedro Pérez'),
  ]
  const s = sugerirContactos({ email: 'laura.gomez@gmail.test', nombre: 'Laura Gomez', pagadoEn: hoy }, contactos, [])
  const ids = s.map((x) => x.contactId)
  assert.ok(ids.includes('errata'))
  assert.ok(ids.includes('nombre'))
  assert.ok(!ids.includes('ruido'))
  assert.match(s.find((x) => x.contactId === 'errata').razones.join(' '), /errata/)
  assert.match(s.find((x) => x.contactId === 'nombre').razones.join(' '), /nombre y apellido/)
  const d = sugerirContactos({ email: 'trabajo@empresa.test', nombre: null, pagadoEn: hoy }, contactos, [])
  assert.deepEqual(
    d.map((x) => x.contactId),
    ['dominio']
  )
})

test('sugerencias: una llamada reciente sola no basta, pero refuerza otra señal', () => {
  const contactos = [c('solo-agenda', 'a@x.test', 'Nada Parecido'), c('nombre', 'b@x.test', 'Laura Gómez')]
  const agendas = [llamada('solo-agenda', 2), llamada('nombre', 3)]
  const s = sugerirContactos({ email: 'zzz@otro.test', nombre: 'Laura Gómez', pagadoEn: hoy }, contactos, agendas)
  assert.deepEqual(
    s.map((x) => x.contactId),
    ['nombre']
  )
  assert.ok(s[0].puntos > 60)
  assert.match(s[0].razones.join(' '), /llamada hace 3 días/)
  // Una llamada cancelada o de hace meses no cuenta.
  const viejas = sugerirContactos({ email: 'zzz@otro.test', nombre: 'Laura Gómez', pagadoEn: hoy }, contactos, [
    llamada('nombre', 90),
    llamada('nombre', 2, 'cancelled'),
  ])
  assert.equal(viejas[0].puntos, 60)
})

test('sugerencias: solo el nombre de pila es señal floja y no se enseña', () => {
  const s = sugerirContactos(
    { email: 'zzz@otro.test', nombre: 'Laura Martín', pagadoEn: hoy },
    [c('a', 'a@x.test', 'Laura Gómez')],
    []
  )
  assert.deepEqual(s, [])
})

test('vincular: solo administración, recuerda cliente y correo, no deja el correo en la acta y la sync no pisa el vínculo', () => {
  const r = readFileSync('app/api/[tenant]/evergreen/sales/payment-inbox/vincular/route.ts', 'utf8')
  assert.match(r, /\['admin', 'director'\]\.includes\(session\.role/)
  assert.match(r, /conAlias\(contacto, pago\.customer_email\)/)
  assert.match(r, /from\('stripe_customers'\)/)
  assert.ok(!/new_values:[^}]*customer_email/.test(r), 'la acta no lleva el correo en claro')
  const sync = readFileSync('lib/finance/stripeCustomers.ts', 'utf8')
  assert.match(sync, /vinculoManual\.get\(stripeCustomerId\)/)
  assert.match(sync, /emailsDeContacto\(c\)/)
})
