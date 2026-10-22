import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import { procesarMensajeEntrante } from '../lib/conversaciones/orquestador.ts'
import { leerConfigAgente, aGuardable, enlaceSeguro } from '../lib/conversaciones/config.ts'
import { coincideConIntento } from '../lib/conversaciones/eco.ts'

// ── Base en memoria con lo justo del cliente de Supabase (select/eq/gte/order/limit/head+count/insert/update/upsert)
class Q {
  constructor(db, t) {
    Object.assign(this, {
      db,
      t,
      f: [],
      op: 'select',
      payload: null,
      opts: null,
      uno: null,
      orden: null,
      lim: null,
      cab: false,
    })
  }
  select(_c, o) {
    if (o?.head) this.cab = true
    this.cnt = o?.count
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
    this.f.push((r) => (c.includes('->>') ? r.data?.[c.split('->>')[1]] === v : r[c] === v))
    return this
  }
  gte(c, v) {
    this.f.push((r) => String(r[c]) >= v)
    return this
  }
  order(c, o) {
    this.orden = [c, o?.ascending !== false]
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
    const ok = (r) => this.f.every((fn) => fn(r))
    let filas
    if (this.op === 'insert' || this.op === 'upsert') {
      const def =
        this.t === 'conversations'
          ? {
              unread_count: 0,
              snoozed_until: null,
              last_inbound_at: null,
              last_message_at: null,
              first_reply_at: null,
              labels: [],
            }
          : {}
      const n = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...def, ...this.payload }
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
    } else {
      filas = tabla.filter(ok)
      if (this.orden)
        filas = [...filas].sort(
          (a, b) => (String(a[this.orden[0]]) < String(b[this.orden[0]]) ? -1 : 1) * (this.orden[1] ? 1 : -1)
        )
      if (this.lim != null) filas = filas.slice(0, this.lim)
    }
    if (this.cab) return { data: null, count: filas.length, error: null }
    if (this.uno) return { data: filas[0] ?? null, error: null }
    return { data: filas, error: null }
  }
}
const cliente = (db) => ({ from: (t) => new Q(db, t) })

const AHORA = new Date('2026-10-22T12:00:00Z')
const hace = (h) => new Date(AHORA.getTime() - h * 3_600_000).toISOString()
const CFG = {
  activo: true,
  permitirAutonomo: true,
  enlaceAgenda: 'https://cal.example.test/llamada',
  negocio: 'Academia Demo',
  pasos: [{ clave: 'ingresos', objetivo: 'sus ingresos' }],
}

function escenario({ modo = 'autonomo', mensajeLead = 'Hola, me interesa saber más', cfg = CFG, extra = {} } = {}) {
  const db = {
    integration_settings: cfg ? [{ tenant_id: 'T', key: 'conversaciones_agente', value: JSON.stringify(cfg) }] : [],
    conversations: [
      {
        id: 'C1',
        tenant_id: 'T',
        source: 'ghl',
        external_id: 'g1',
        channel: 'instagram',
        status: 'pendiente',
        ai_mode: modo,
        contact_id: 'ct1',
        contact_external_id: 'k1',
        last_inbound_at: hace(1),
        labels: [],
        unread_count: 1,
        ...extra,
      },
    ],
    conversation_messages: [
      {
        id: 'M1',
        tenant_id: 'T',
        conversation_id: 'C1',
        external_id: 'm1',
        direction: 'entrante',
        author: 'lead',
        body: mensajeLead,
        sent_at: hace(1),
      },
    ],
    conversation_events: [],
    contacts: [{ id: 'ct1', tenant_id: 'T', qualification: null }],
  }
  const llamadas = { ia: 0, enviar: [] }
  const deps = {
    ahora: () => AHORA,
    ia: async () => {
      llamadas.ia++
      return { text: llamadas.respuesta ?? '¿Y cuánto estás generando ahora mismo?' }
    },
    enviar: async (p) => {
      llamadas.enviar.push(p)
      return { messageId: 'ghl-out-1' }
    },
  }
  return { db, sb: cliente(db), deps, llamadas }
}
const correr = (e) => procesarMensajeEntrante(e.sb, 'T', 'C1', 'm1', e.deps)

test('por defecto no hace NADA: sin configuración guardada el agente está apagado y ni siquiera llama a la IA', async () => {
  const e = escenario({ cfg: null })
  const r = await correr(e)
  assert.deepEqual(r, { accion: 'silencio', motivo: 'agente_apagado' })
  assert.equal(e.llamadas.ia, 0)
  assert.equal(e.llamadas.enviar.length, 0)
})

test('con la IA apagada en la conversación no se lee ni se llama a nada', async () => {
  const e = escenario({ modo: 'off' })
  assert.equal((await correr(e)).motivo, 'conversacion_apagada')
  assert.equal(e.llamadas.ia, 0)
})

test('autónomo: redacta, envía por el canal, guarda el mensaje como de la IA y audita', async () => {
  const e = escenario()
  const r = await correr(e)
  assert.equal(r.accion, 'enviado')
  assert.equal(e.llamadas.enviar.length, 1)
  assert.equal(e.llamadas.enviar[0].canal, 'instagram')
  assert.equal(e.llamadas.enviar[0].contactExternalId, 'k1')
  const guardado = e.db.conversation_messages.find((m) => m.author === 'ia')
  assert.ok(guardado)
  assert.equal(guardado.external_id, 'ghl-out-1')
  const tipos = e.db.conversation_events.map((x) => x.kind)
  for (const k of ['agente', 'ia_intento', 'ia_envio']) assert.ok(tipos.includes(k), k)
  assert.equal(e.db.conversations[0].status, 'pendiente')
})

test('borrador: guarda la propuesta para aprobar y NO envía nada', async () => {
  const e = escenario({ modo: 'borrador' })
  const r = await correr(e)
  assert.equal(r.accion, 'borrador')
  assert.equal(e.llamadas.enviar.length, 0)
  const b = e.db.conversation_events.find((x) => x.kind === 'borrador')
  assert.equal(b.data.estado, 'pendiente')
  assert.match(b.data.texto, /cuánto estás generando/)
})

test('si la subcuenta no permite autónomo, una conversación en autónomo queda en borrador', async () => {
  const e = escenario({ cfg: { ...CFG, permitirAutonomo: false } })
  assert.equal((await correr(e)).accion, 'borrador')
  assert.equal(e.llamadas.enviar.length, 0)
})

test('idempotente: el mismo mensaje se procesa una sola vez (reintento del webhook)', async () => {
  const e = escenario()
  assert.equal((await correr(e)).accion, 'enviado')
  assert.deepEqual(await correr(e), { accion: 'ya_procesado' })
  assert.equal(e.llamadas.ia, 1)
  assert.equal(e.llamadas.enviar.length, 1)
})

test('traspaso por precio: no llama a la IA, pasa a abierta, apaga la IA y lo anota', async () => {
  const e = escenario({ mensajeLead: '¿cuánto cuesta el programa?' })
  const r = await correr(e)
  assert.equal(r.accion, 'traspaso')
  assert.equal(e.llamadas.ia, 0)
  assert.equal(e.db.conversations[0].status, 'abierta')
  assert.equal(e.db.conversations[0].ai_mode, 'off')
  assert.equal(e.db.conversation_events.find((x) => x.kind === 'traspaso').data.motivo, 'precio_o_condiciones')
})

test('STOP / baja: traspasa y marca la conversación como no contactar', async () => {
  const e = escenario({ mensajeLead: 'STOP' })
  await correr(e)
  assert.ok(e.db.conversations[0].labels.includes('no-contactar'))
  assert.equal(e.llamadas.enviar.length, 0)
})

test('si el modelo menciona un precio o un enlace ajeno, se descarta, no se envía y se traspasa', async () => {
  for (const mala of ['El programa cuesta 997 €', 'Mira https://otro.example.test/x', 'TRASPASO', '']) {
    const e = escenario()
    e.llamadas.respuesta = mala
    const r = await correr(e)
    assert.equal(r.accion, 'traspaso', mala)
    assert.equal(e.llamadas.enviar.length, 0, mala)
    assert.equal(e.db.conversations[0].ai_mode, 'off', mala)
  }
})

test('si la IA falla o el envío falla, no se pierde al lead: pasa a una persona y no reintenta a ciegas', async () => {
  const a = escenario()
  a.deps.ia = async () => {
    throw new Error('sin saldo')
  }
  assert.equal((await correr(a)).accion, 'error')
  assert.equal(a.db.conversations[0].status, 'abierta')
  const b = escenario()
  b.deps.enviar = async () => {
    throw new Error('GHL 500')
  }
  assert.equal((await correr(b)).accion, 'error')
  assert.equal(b.db.conversations[0].ai_mode, 'off')
  assert.equal(b.db.conversation_messages.filter((m) => m.author === 'ia').length, 0)
})

test('canal no autorizado (TikTok), ventana cerrada y persona que ya respondió: silencio sin llamar a la IA', async () => {
  const tk = escenario({ extra: { channel: 'tiktok' } })
  assert.equal((await correr(tk)).motivo, 'canal_no_autorizado')
  const vc = escenario({ extra: { last_inbound_at: hace(30) } })
  assert.equal((await correr(vc)).motivo, 'ventana_cerrada')
  const hu = escenario()
  hu.db.conversation_messages.push({
    id: 'M2',
    tenant_id: 'T',
    conversation_id: 'C1',
    external_id: 'm2',
    direction: 'saliente',
    author: 'humano',
    body: 'Hola, soy Ana',
    sent_at: hace(0.5),
  })
  assert.equal((await correr(hu)).motivo, 'humano_atiende')
  for (const x of [tk, vc, hu]) assert.equal(x.llamadas.ia, 0)
})

test('tope diario: con los envíos del día agotados no actúa', async () => {
  const e = escenario({ cfg: { ...CFG, maxEnviosDia: 2 } })
  for (let i = 0; i < 2; i++)
    e.db.conversation_events.push({
      id: `x${i}`,
      tenant_id: 'T',
      conversation_id: 'C9',
      kind: 'ia_envio',
      data: {},
      created_at: AHORA.toISOString(),
    })
  assert.equal((await correr(e)).motivo, 'tope_diario')
})

test('no pregunta lo que ya sabe: las claves de la cualificación del contacto salen del prompt', async () => {
  const e = escenario()
  e.db.contacts[0].qualification = { ingresos: '1500', respuestas: [] }
  let sistema = ''
  e.deps.ia = async (req) => {
    sistema = req.system
    return { text: 'Genial, ¿y qué buscas conseguir?' }
  }
  await correr(e)
  assert.match(sistema, /propón la llamada/)
})

test('config: solo un true explícito activa; lo roto cae al valor seguro y el enlace debe ser https', () => {
  assert.equal(leerConfigAgente(null).config.activo, false)
  assert.equal(leerConfigAgente('no es json').config.activo, false)
  assert.equal(leerConfigAgente({ activo: 'true' }).config.activo, false)
  assert.equal(leerConfigAgente({ activo: true }).config.activo, true)
  assert.equal(leerConfigAgente({ activo: true, maxEnviosDia: 99999 }).config.maxEnviosDia, 200)
  assert.equal(leerConfigAgente({ horario: { desde: 9, hasta: 9, zona: 'Europe/Madrid' } }).config.horario, null)
  assert.equal(enlaceSeguro('http://x.test/a'), null)
  assert.equal(enlaceSeguro('https://u:p@x.test/a'), null)
  assert.equal(enlaceSeguro('javascript:alert(1)'), null)
  assert.equal(enlaceSeguro('https://cal.example.test/a'), 'https://cal.example.test/a')
  const g = JSON.parse(
    aGuardable({ activo: true, enlaceAgenda: 'http://malo', pasos: [{ clave: 'No válida!', objetivo: 'x' }] })
  )
  assert.equal(g.enlaceAgenda, null)
  assert.deepEqual(g.pasos, [])
})

test('eco: el saliente con el mismo texto que acaba de enviar la IA no cuenta como persona', () => {
  const m = { direccion: 'saliente', texto: 'Hola   mundo', enviadoEn: AHORA.toISOString() }
  const intento = [{ texto: 'Hola mundo', creadoEn: new Date(AHORA.getTime() - 20_000).toISOString() }]
  assert.equal(coincideConIntento(m, intento, AHORA), true)
  assert.equal(coincideConIntento({ ...m, texto: 'Otro texto' }, intento, AHORA), false)
  assert.equal(coincideConIntento({ ...m, direccion: 'entrante' }, intento, AHORA), false)
  assert.equal(coincideConIntento(m, [{ texto: 'Hola mundo', creadoEn: hace(1) }], AHORA), false)
})

test('el webhook marca el eco antes de guardar y lanza al agente solo con entrantes nuevos, en segundo plano', () => {
  const r = readFileSync('app/api/[tenant]/evergreen/webhooks/ghl-mensajes/route.ts', 'utf8')
  assert.match(r, /marcarEcoDeIA\(sb, tenantRow\.id as string, normalizado\)/)
  assert.match(r, /if \(r\.nuevo && mensaje\.direccion === 'entrante'\)/)
  assert.match(r, /after\(async/)
})
