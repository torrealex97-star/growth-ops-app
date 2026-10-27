import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parchePorMensaje, registrarMensaje } from '../lib/conversaciones/persistir.ts'
import { normalizarMensajeGhl } from '../lib/conversaciones/ingesta.ts'

const conv = (extra = {}) => ({
  id: 'c1',
  status: 'abierta',
  snoozed_until: null,
  last_inbound_at: null,
  last_message_at: null,
  first_reply_at: null,
  unread_count: 0,
  ...extra,
})
const msg = (extra = {}) =>
  normalizarMensajeGhl({
    messageId: 'm1',
    conversationId: 'g1',
    contactId: 'k1',
    direction: 'inbound',
    messageType: 'TYPE_INSTAGRAM',
    body: 'hola',
    dateAdded: '2026-10-22T10:00:00Z',
    ...extra,
  })

test('un mensaje entrante suma no leídos, fija el último entrante y reabre lo resuelto', () => {
  const p = parchePorMensaje(conv({ status: 'resuelta', unread_count: 1 }), msg())
  assert.equal(p.status, 'abierta')
  assert.equal(p.unread_count, 2)
  assert.equal(p.last_inbound_at, '2026-10-22T10:00:00.000Z')
})

test('si la atiende la IA (pendiente), un entrante la mantiene pendiente', () => {
  assert.equal(parchePorMensaje(conv({ status: 'pendiente' }), msg()).status, 'pendiente')
})

test('una respuesta humana deja a cero los no leídos, pasa a abierta y fija la primera respuesta', () => {
  const base = conv({ status: 'pendiente', unread_count: 3, last_inbound_at: '2026-10-22T09:00:00.000Z' })
  const p = parchePorMensaje(base, msg({ messageId: 'm2', direction: 'outbound', dateAdded: '2026-10-22T10:05:00Z' }))
  assert.equal(p.status, 'abierta')
  assert.equal(p.unread_count, 0)
  assert.equal(p.first_reply_at, '2026-10-22T10:05:00.000Z')
})

test('la primera respuesta no se pisa y un saliente sin entrante previo no cuenta como respuesta', () => {
  const ya = parchePorMensaje(
    conv({ first_reply_at: '2026-10-22T08:00:00.000Z', last_inbound_at: '2026-10-22T07:00:00.000Z' }),
    msg({ direction: 'outbound' })
  )
  assert.equal(ya.first_reply_at, '2026-10-22T08:00:00.000Z')
  const frio = parchePorMensaje(conv(), msg({ direction: 'outbound' }))
  assert.equal(frio.first_reply_at, null)
})

test('un mensaje antiguo (sincronización) no retrocede las fechas', () => {
  const p = parchePorMensaje(
    conv({ last_message_at: '2026-10-22T12:00:00.000Z', last_inbound_at: '2026-10-22T12:00:00.000Z' }),
    msg()
  )
  assert.equal(p.last_message_at, '2026-10-22T12:00:00.000Z')
  assert.equal(p.last_inbound_at, '2026-10-22T12:00:00.000Z')
})

// Base en memoria mínima, con la forma del cliente de Supabase que usa registrarMensaje.
class Q {
  constructor(db, t) {
    Object.assign(this, { db, t, f: [], op: 'select', payload: null, opts: null, uno: null })
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
  limit() {
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
    const ok = (r) => this.f.every((fn) => fn(r))
    let filas
    if (this.op === 'insert' || this.op === 'upsert') {
      // Los valores por defecto de la tabla (la BD real los pone sola).
      const porDefecto =
        this.t === 'conversations'
          ? { unread_count: 0, snoozed_until: null, last_inbound_at: null, last_message_at: null, first_reply_at: null }
          : {}
      const n = { id: crypto.randomUUID(), ...porDefecto, ...this.payload }
      const claves = this.opts?.onConflict?.split(',')
      const previa = claves && tabla.find((r) => claves.every((k) => r[k] === n[k]))
      if (previa) {
        filas = this.opts.ignoreDuplicates ? [] : (Object.assign(previa, n, { id: previa.id }), [previa])
      } else {
        tabla.push(n)
        filas = [n]
      }
    } else if (this.op === 'update') {
      filas = tabla.filter(ok)
      for (const r of filas) Object.assign(r, this.payload)
    } else filas = tabla.filter(ok)
    if (this.uno) return { data: filas[0] ?? null, error: null }
    return { data: filas, error: null }
  }
}
const cliente = (db) => ({ from: (t) => new Q(db, t) })

test('registrarMensaje: crea la conversación, vincula el contacto de GHL y es idempotente', async () => {
  const db = { contacts: [{ id: 'ct1', tenant_id: 'T', ghl_contact_id: 'k1', merged_into: null }] }
  const sb = cliente(db)
  const a = await registrarMensaje(sb, 'T', msg())
  const b = await registrarMensaje(sb, 'T', msg())
  assert.equal(a.ok && a.nuevo, true)
  assert.equal(b.ok && b.nuevo, false)
  assert.equal(db.conversations.length, 1)
  assert.equal(db.conversations[0].contact_id, 'ct1')
  assert.equal(db.conversations[0].ai_mode, 'off', 'una conversación nueva nace con la IA apagada')
  assert.equal(db.conversation_messages.length, 1)
  // El reintento NO duplicó el contador de no leídos.
  assert.equal(db.conversations[0].unread_count, 1)
})

test('registrarMensaje: respuesta humana después del entrante actualiza estado, primera respuesta y deja auditoría', async () => {
  const db = { contacts: [] }
  const sb = cliente(db)
  await registrarMensaje(sb, 'T', msg())
  db.conversations[0].status = 'pendiente'
  await registrarMensaje(sb, 'T', msg({ messageId: 'm2', direction: 'outbound', dateAdded: '2026-10-22T10:10:00Z' }))
  assert.equal(db.conversations[0].status, 'abierta')
  assert.equal(db.conversations[0].unread_count, 0)
  assert.equal(db.conversations[0].first_reply_at, '2026-10-22T10:10:00.000Z')
  assert.equal(db.conversation_events.length, 1)
  assert.equal(db.conversation_events[0].data.a, 'abierta')
})

test('la ruta del webhook exige el secreto, responde igual a subcuenta inexistente y es idempotente', () => {
  const r = readFileSync('app/api/[tenant]/evergreen/webhooks/ghl-mensajes/route.ts', 'utf8')
  assert.match(r, /isValidWebhookSecret\(req\.headers\.get\('x-ghl-secret'\), esperado\)/)
  assert.match(r, /if \(!tenantRow\) return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\)/)
  assert.match(r, /normalizarMensajeGhl\(payload\)/)
  assert.match(r, /registrarMensaje\(sb, tenantRow\.id as string, mensaje\)/)
})

test('los tipos generados incluyen las tablas de conversaciones', () => {
  const t = readFileSync('lib/types/database-generated.ts', 'utf8')
  for (const n of ['Conversations', 'ConversationMessages', 'ConversationEvents'])
    assert.match(t, new RegExp(`    ${n}: \\{`))
})

// ── Revisión 27-oct: reintento tras un fallo parcial
import { cliente as clienteMem } from './fixtures/supabase-memoria.mjs'
import { registrarMensaje as registrar } from '../lib/conversaciones/persistir.ts'

test('reintento de GHL tras fallar la actualización de la conversación: el efecto se aplica y se reactiva al agente', async () => {
  const db = {
    conversations: [
      {
        id: 'C1',
        tenant_id: 'T',
        source: 'ghl',
        external_id: 'g1',
        channel: 'instagram',
        status: 'abierta',
        last_inbound_at: null,
        last_message_at: null,
        first_reply_at: null,
        unread_count: 0,
        snoozed_until: null,
        labels: [],
      },
    ],
    // El mensaje ya se insertó en la primera entrega…
    conversation_messages: [
      {
        id: 'M1',
        tenant_id: 'T',
        conversation_id: 'C1',
        external_id: 'm1',
        direction: 'entrante',
        author: 'lead',
        body: 'hola',
        sent_at: '2026-10-27T10:00:00.000Z',
      },
    ],
    conversation_events: [],
    contacts: [],
  }
  const msg = {
    externalId: 'm1',
    conversationExternalId: 'g1',
    contactExternalId: 'k1',
    canal: 'instagram',
    direccion: 'entrante',
    autor: 'lead',
    texto: 'hola',
    enviadoEn: '2026-10-27T10:00:00.000Z',
  }
  // …pero la conversación no avanzó: el reintento debe aplicarla y devolver `nuevo` para que el agente actúe.
  const r1 = await registrar(clienteMem(db), 'T', msg)
  assert.deepEqual(r1, { ok: true, nuevo: true, conversationId: 'C1' })
  assert.equal(db.conversations[0].last_inbound_at, '2026-10-27T10:00:00.000Z')
  assert.equal(db.conversations[0].unread_count, 1)
  // Un segundo reintento ya no cambia nada ni vuelve a contar el mensaje.
  const r2 = await registrar(clienteMem(db), 'T', msg)
  assert.equal(r2.nuevo, false)
  assert.equal(db.conversations[0].unread_count, 1)
})
