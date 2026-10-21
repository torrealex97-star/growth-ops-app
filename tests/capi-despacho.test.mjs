import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { despacharCapi } from '../lib/meta/capi-dispatch.ts'

const CFG_ON = { META_PIXEL_ID: '123456789012345', META_ACCESS_TOKEN: 'TOK', META_CAPI_ENABLED: 'true' }

function entorno() {
  const llamadas = []
  const inserts = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    llamadas.push({ url: String(url), body: JSON.parse(init.body) })
    return new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'F1' }), { status: 200 })
  }
  const sb = { from: (t) => ({ insert: async (p) => (inserts.push({ t, p }), { error: null }) }) }
  return { llamadas, inserts, sb, restaurar: () => (globalThis.fetch = original) }
}

const base = (sb, extra = {}) => ({
  sb,
  tenantId: 'T1',
  canonicalEventId: 'ce1',
  eventName: 'lead',
  eventId: 'evt-1',
  receivedAt: new Date('2026-10-01T10:00:00Z'),
  body: {
    url: 'https://x.com/',
    fbc: 'fb.1.1700000000123.ABC',
    fbp: 'fb.1.1700000000123.99',
    properties: { email: 'a@b.com' },
  },
  clientIp: '1.2.3.4',
  userAgent: 'UA',
  cargarConfig: async () => CFG_ON,
  ...extra,
})

test('con CAPI activada envía el Lead con el event_id del navegador y registra el intento', async () => {
  const e = entorno()
  try {
    const r = await despacharCapi(base(e.sb))
    assert.deepEqual(r, { enviado: true, ok: true })
    assert.equal(e.llamadas.length, 1)
    const ev = e.llamadas[0].body.data[0]
    assert.equal(ev.event_name, 'Lead')
    assert.equal(ev.event_id, 'evt-1')
    assert.equal(ev.user_data.fbc, 'fb.1.1700000000123.ABC')
    assert.ok(!JSON.stringify(ev).includes('a@b.com'))
    assert.equal(e.llamadas[0].body.test_event_code, undefined)
    assert.equal(e.inserts[0].t, 'delivery_attempts')
    assert.equal(e.inserts[0].p.destination, 'meta_capi')
    assert.equal(e.inserts[0].p.status, 'accepted')
    assert.equal(e.inserts[0].p.tenant_id, 'T1')
  } finally {
    e.restaurar()
  }
})

test('appointment_booked se envía como Schedule', async () => {
  const e = entorno()
  try {
    await despacharCapi(base(e.sb, { eventName: 'appointment_booked' }))
    assert.equal(e.llamadas[0].body.data[0].event_name, 'Schedule')
  } finally {
    e.restaurar()
  }
})

test('apagada (sin activar, sin Pixel o sin token) no hace ninguna llamada', async () => {
  for (const cfg of [
    {},
    { ...CFG_ON, META_CAPI_ENABLED: 'false' },
    { ...CFG_ON, META_PIXEL_ID: '' },
    { ...CFG_ON, META_ACCESS_TOKEN: '' },
  ]) {
    const e = entorno()
    try {
      const r = await despacharCapi(base(e.sb, { cargarConfig: async () => cfg }))
      assert.deepEqual(r, { enviado: false, motivo: 'capi_apagada' })
      assert.equal(e.llamadas.length, 0)
      assert.equal(e.inserts.length, 0)
    } finally {
      e.restaurar()
    }
  }
})

test('purchase y page_view nunca se envían desde la ingesta', async () => {
  for (const eventName of ['purchase', 'page_view', 'cta_click']) {
    const e = entorno()
    try {
      const r = await despacharCapi(base(e.sb, { eventName }))
      assert.deepEqual(r, { enviado: false, motivo: 'evento_no_aplica' })
      assert.equal(e.llamadas.length, 0)
    } finally {
      e.restaurar()
    }
  }
})

test('sin event_id (no se puede deduplicar) o sin señales de emparejamiento no se envía', async () => {
  const e = entorno()
  try {
    assert.equal((await despacharCapi(base(e.sb, { eventId: null }))).motivo, 'sin_event_id')
    const sinNada = await despacharCapi(base(e.sb, { body: { url: 'https://x.com/', properties: {} } }))
    assert.equal(sinNada.motivo, 'sin_datos_de_contacto')
    assert.equal(e.llamadas.length, 0)
  } finally {
    e.restaurar()
  }
})

test('un fbc con formato inválido se descarta en vez de enviarse', async () => {
  const e = entorno()
  try {
    await despacharCapi(base(e.sb, { body: { fbc: '<script>', properties: { email: 'a@b.com' } } }))
    assert.equal(e.llamadas[0].body.data[0].user_data.fbc, undefined)
  } finally {
    e.restaurar()
  }
})

test('un error de Meta se registra como failed y no lanza', async () => {
  const e = entorno()
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Permisos' } }), { status: 400 })
  try {
    const r = await despacharCapi(base(e.sb))
    assert.deepEqual(r, { enviado: true, ok: false, error: 'Permisos' })
    assert.equal(e.inserts[0].p.status, 'failed')
    assert.equal(e.inserts[0].p.last_error, 'Permisos')
  } finally {
    e.restaurar()
  }
})

test('solo la ingesta en vivo dispara la CAPI; el reproceso no', () => {
  const ingesta = readFileSync('app/api/track/[site]/route.ts', 'utf8')
  const reproceso = readFileSync('app/api/[tenant]/evergreen/tracking/reproceso/route.ts', 'utf8')
  assert.match(ingesta, /capi: \{ clientIp: ip, userAgent, bot: bot === 'likely_bot' \}/)
  assert.doesNotMatch(reproceso, /capi:/)
})

test('un bot no dispara la CAPI desde la ingesta', () => {
  const n = readFileSync('lib/tracking/normalizar.ts', 'utf8')
  assert.match(n, /args\.capi && !args\.capi\.bot && EVENTOS_CAPI\[eventName\]/)
})
