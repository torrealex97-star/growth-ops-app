import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { descartarBorrador, enviarComoPersona, MAX_TEXTO } from '../lib/conversaciones/envio.ts'

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
      const def =
        this.t === 'conversations'
          ? { unread_count: 0, snoozed_until: null, last_inbound_at: null, last_message_at: null, first_reply_at: null }
          : {}
      const n = { id: crypto.randomUUID(), ...def, ...this.payload }
      const claves = this.opts?.onConflict?.split(',')
      const previa = claves && tabla.find((r) => claves.every((k) => r[k] === n[k]))
      if (previa) filas = this.opts.ignoreDuplicates ? [] : (Object.assign(previa, n, { id: previa.id }), [previa])
      else {
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

const AHORA = new Date('2026-10-22T12:00:00Z')
const hace = (h) => new Date(AHORA.getTime() - h * 3_600_000).toISOString()

function escenario(extra = {}) {
  const db = {
    conversations: [
      {
        id: 'C1',
        tenant_id: 'T',
        source: 'ghl',
        external_id: 'g1',
        channel: 'instagram',
        status: 'abierta',
        contact_external_id: 'k1',
        last_inbound_at: hace(2),
        last_message_at: hace(2),
        unread_count: 2,
        first_reply_at: null,
        ...extra,
      },
    ],
    conversation_messages: [],
    conversation_events: [
      {
        id: 'E1',
        tenant_id: 'T',
        conversation_id: 'C1',
        kind: 'borrador',
        data: { texto: 'Hola, ¿cuánto estás generando?', estado: 'pendiente' },
      },
    ],
  }
  const enviados = []
  const deps = {
    ahora: () => AHORA,
    enviar: async (p) => {
      enviados.push(p)
      return { messageId: 'out-1' }
    },
  }
  return { db, sb: cliente(db), deps, enviados }
}

test('responder: envía por el canal de la conversación, guarda el mensaje del equipo y audita quién lo envió', async () => {
  const e = escenario()
  const r = await enviarComoPersona(e.sb, 'T', 'C1', '  Hola Ana  ', 'U1', e.deps, { tipo: 'respuesta' })
  assert.equal(r.ok, true)
  assert.deepEqual(
    { canal: e.enviados[0].canal, contacto: e.enviados[0].contactExternalId, texto: e.enviados[0].texto },
    { canal: 'instagram', contacto: 'k1', texto: 'Hola Ana' }
  )
  assert.equal(e.db.conversation_messages[0].author, 'humano')
  assert.equal(e.db.conversations[0].unread_count, 0)
  const ev = e.db.conversation_events.find((x) => x.kind === 'respuesta')
  assert.equal(ev.actor_user_id, 'U1')
})

test('responder: ventana cerrada, texto vacío o enorme, sin contacto GHL y conversación inexistente se rechazan sin enviar', async () => {
  const cerrada = escenario({ last_inbound_at: hace(30) })
  assert.equal(
    (await enviarComoPersona(cerrada.sb, 'T', 'C1', 'hola', 'U1', cerrada.deps, { tipo: 'respuesta' })).status,
    409
  )
  const nada = escenario({ last_inbound_at: null })
  assert.equal(
    (await enviarComoPersona(nada.sb, 'T', 'C1', 'hola', 'U1', nada.deps, { tipo: 'respuesta' })).status,
    409
  )
  const e = escenario()
  assert.equal((await enviarComoPersona(e.sb, 'T', 'C1', '   ', 'U1', e.deps, { tipo: 'respuesta' })).status, 400)
  assert.equal(
    (await enviarComoPersona(e.sb, 'T', 'C1', 'x'.repeat(MAX_TEXTO + 1), 'U1', e.deps, { tipo: 'respuesta' })).status,
    400
  )
  assert.equal((await enviarComoPersona(e.sb, 'T', 'NO', 'hola', 'U1', e.deps, { tipo: 'respuesta' })).status, 404)
  const sin = escenario({ contact_external_id: null })
  assert.equal((await enviarComoPersona(sin.sb, 'T', 'C1', 'hola', 'U1', sin.deps, { tipo: 'respuesta' })).status, 400)
  for (const x of [cerrada, nada, e, sin]) assert.equal(x.enviados.length, 0)
})

test('otra subcuenta no puede responder en una conversación ajena', async () => {
  const e = escenario()
  assert.equal((await enviarComoPersona(e.sb, 'OTRA', 'C1', 'hola', 'U1', e.deps, { tipo: 'respuesta' })).status, 404)
  assert.equal(e.enviados.length, 0)
})

test('aprobar un borrador lo envía una vez y lo marca aprobado; un segundo intento no reenvía', async () => {
  const e = escenario()
  const a = await enviarComoPersona(e.sb, 'T', 'C1', 'Hola, ¿cuánto estás generando?', 'U1', e.deps, {
    tipo: 'borrador',
    eventoId: 'E1',
  })
  const b = await enviarComoPersona(e.sb, 'T', 'C1', 'Hola, ¿cuánto estás generando?', 'U2', e.deps, {
    tipo: 'borrador',
    eventoId: 'E1',
  })
  assert.equal(a.ok, true)
  assert.equal(b.ok, false)
  assert.equal(b.status, 409)
  assert.equal(e.enviados.length, 1)
  assert.equal(e.db.conversation_events.find((x) => x.id === 'E1').data.estado, 'aprobado')
})

test('si falla el envío de un borrador, vuelve a pendiente para poder reintentarlo', async () => {
  const e = escenario()
  e.deps.enviar = async () => {
    throw new Error('GHL 500')
  }
  const r = await enviarComoPersona(e.sb, 'T', 'C1', 'Hola', 'U1', e.deps, { tipo: 'borrador', eventoId: 'E1' })
  assert.equal(r.ok, false)
  assert.equal(r.status, 502)
  assert.equal(e.db.conversation_events.find((x) => x.id === 'E1').data.estado, 'pendiente')
  assert.equal(e.db.conversation_messages.length, 0)
})

test('descartar: solo un borrador pendiente, y una vez', async () => {
  const e = escenario()
  assert.equal((await descartarBorrador(e.sb, 'T', 'C1', 'E1', 'U1')).ok, true)
  assert.equal((await descartarBorrador(e.sb, 'T', 'C1', 'E1', 'U1')).status, 409)
  assert.equal((await descartarBorrador(e.sb, 'T', 'C1', 'NO', 'U1')).status, 404)
  assert.equal(e.db.conversation_events.find((x) => x.id === 'E1').data.estado, 'descartado')
})

test('las rutas exigen rol de gestión; solo admin/director tocan la configuración; el borrador editado se re-valida', () => {
  const resp = readFileSync('app/api/[tenant]/evergreen/conversaciones/[id]/responder/route.ts', 'utf8')
  const borr = readFileSync('app/api/[tenant]/evergreen/conversaciones/[id]/borradores/route.ts', 'utf8')
  const ag = readFileSync('app/api/[tenant]/evergreen/conversaciones/agente/route.ts', 'utf8')
  for (const r of [resp, borr]) assert.match(r, /ROLES_GESTION as readonly string\[\]\)\.includes\(rol\)/)
  assert.match(resp, /limitar\(`conv:resp:\$\{sesion\.userId\}`/)
  assert.match(borr, /validarBorrador\(typeof c\.texto === 'string' \? c\.texto : '', guion\.enlaceAgenda\)/)
  assert.match(ag, /ROLES_IA as readonly string\[\]/)
  assert.match(ag, /aGuardable\(cuerpo\)/)
  assert.match(ag, /from\('audit_logs'\)\.insert/)
})

test('la pantalla ofrece responder, aprobar y descartar borradores, y la configuración solo a admin/director', () => {
  const p = readFileSync('app/[tenant]/conversaciones/BandejaTab.tsx', 'utf8')
  assert.match(p, /conversaciones\/\$\{sel\}\/responder/)
  assert.match(p, /conversaciones\/\$\{sel\}\/borradores/)
  assert.match(p, /Aprobar y enviar/)
  assert.match(p, /disabled=\{!ventana\?\.abierta\}/)
  const shell = readFileSync('app/[tenant]/conversaciones/page.tsx', 'utf8')
  assert.match(shell, /t !== 'agente' \|\| puedeIA/)
  const a = readFileSync('app/[tenant]/conversaciones/AgenteTab.tsx', 'utf8')
  assert.match(a, /Agente activo en esta subcuenta \(apagado = no hace nada\)/)
  assert.match(a, /Permitir modo autónomo/)
})
