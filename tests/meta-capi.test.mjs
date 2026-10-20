import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  capiConfig,
  construirEventoCapi,
  enviarEventosCapi,
  eventIdDeterminista,
  fbcDesdeFbclid,
  hashEmail,
  hashTelefono,
} from '../lib/meta/capi.ts'

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex')

test('el email se normaliza antes de hashear y uno inválido no se envía', () => {
  assert.equal(hashEmail('  Ana@Ejemplo.COM '), sha('ana@ejemplo.com'))
  assert.equal(hashEmail('no-es-email'), null)
})

test('el teléfono se envía solo con dígitos y prefijo de país', () => {
  assert.equal(hashTelefono('+34 600-111-222'), sha('34600111222'))
  assert.equal(hashTelefono('0034600111222'), sha('34600111222'))
  assert.equal(hashTelefono('123'), null)
})

test('fbc se arma desde el fbclid y NO se hashea', () => {
  assert.equal(fbcDesdeFbclid('ABC', 1700000000123), 'fb.1.1700000000123.ABC')
  assert.equal(fbcDesdeFbclid('', 1), null)
})

test('el evento lleva PII hasheada, fbc/fbp tal cual, event_id y action_source', () => {
  const e = construirEventoCapi({
    eventName: 'Purchase',
    eventId: eventIdDeterminista('purchase', 's1'),
    eventTime: new Date('2026-10-01T10:00:00Z'),
    url: 'https://x.com/gracias',
    contacto: { email: 'a@b.com', phone: '+34600111222', firstName: 'Ana' },
    fbc: 'fb.1.1.XYZ',
    fbp: 'fb.1.1.123',
    value: 997,
    currency: 'eur',
  })
  assert.equal(e.event_name, 'Purchase')
  assert.equal(e.event_id, 'purchase_s1')
  assert.equal(e.action_source, 'website')
  assert.equal(e.event_time, 1790848800)
  assert.deepEqual(e.custom_data, { value: 997, currency: 'EUR' })
  assert.equal(e.user_data.fbc, 'fb.1.1.XYZ')
  assert.deepEqual(e.user_data.em, [sha('a@b.com')])
  assert.ok(!JSON.stringify(e).includes('a@b.com'))
  assert.ok(!JSON.stringify(e).includes('600111222'))
})

test('sin datos de contacto no se envían claves vacías', () => {
  const e = construirEventoCapi({ eventName: 'Lead', eventId: 'x', eventTime: new Date(0), contacto: {} })
  assert.deepEqual(e.user_data, {})
})

test('CAPI está apagada salvo Pixel numérico + token + activación explícita', () => {
  const base = { META_PIXEL_ID: '123456789012345', META_ACCESS_TOKEN: 't' }
  assert.equal(capiConfig(base), null)
  assert.equal(capiConfig({ ...base, META_CAPI_ENABLED: 'false' }), null)
  assert.equal(capiConfig({ META_ACCESS_TOKEN: 't', META_CAPI_ENABLED: 'true' }), null)
  assert.equal(capiConfig({ ...base, META_PIXEL_ID: 'abc', META_CAPI_ENABLED: 'true' }), null)
  assert.equal(capiConfig({ ...base, META_CAPI_ENABLED: 'true' })?.pixelId, '123456789012345')
  // El checkbox de Integraciones guarda '1'/'0': tiene que activarla.
  assert.equal(capiConfig({ ...base, META_CAPI_ENABLED: '1' })?.pixelId, '123456789012345')
  assert.equal(capiConfig({ ...base, META_CAPI_ENABLED: '0' }), null)
})

test('el envío pone el token en el cuerpo (no en la URL) y manda test_event_code', async () => {
  const original = globalThis.fetch
  let visto
  globalThis.fetch = async (url, init) => {
    visto = { url: String(url), body: JSON.parse(init.body) }
    return new Response(JSON.stringify({ events_received: 1, fbtrace_id: 'T1' }), { status: 200 })
  }
  try {
    const r = await enviarEventosCapi(
      { pixelId: '123456789012345', accessToken: 'SECRET', apiVersion: 'v25.0' },
      [{}],
      {
        testEventCode: 'TEST1',
      }
    )
    assert.deepEqual(r, { ok: true, eventosRecibidos: 1, fbtraceId: 'T1' })
    assert.match(visto.url, /\/v25\.0\/123456789012345\/events$/)
    assert.ok(!visto.url.includes('SECRET'))
    assert.equal(visto.body.access_token, 'SECRET')
    assert.equal(visto.body.test_event_code, 'TEST1')
  } finally {
    globalThis.fetch = original
  }
})

test('un error de Meta se devuelve sin lanzar', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'Permisos' } }), { status: 400 })
  try {
    const r = await enviarEventosCapi({ pixelId: '1', accessToken: 't', apiVersion: 'v25.0' }, [{}])
    assert.equal(r.ok, false)
    assert.equal(r.error, 'Permisos')
  } finally {
    globalThis.fetch = original
  }
})

test('la ruta de prueba exige admin y código TEST, y nada llama a la CAPI sola', () => {
  const r = readFileSync('app/api/[tenant]/evergreen/settings/integraciones/meta-capi-test/route.ts', 'utf8')
  assert.match(r, /\['admin', 'director'\]/)
  assert.match(r, /\^TEST\[A-Za-z0-9\]/)
  assert.match(r, /testEventCode: code/)
})

test('enviarEventosCapi solo lo usan la ruta de prueba y el despacho de la ingesta', async () => {
  const { execSync } = await import('node:child_process')
  const usos = execSync("grep -rln 'enviarEventosCapi' app lib --include=*.ts --include=*.tsx || true")
    .toString()
    .trim()
    .split('\n')
    .sort()
  assert.deepEqual(usos, [
    'app/api/[tenant]/evergreen/settings/integraciones/meta-capi-test/route.ts',
    'lib/meta/capi-dispatch.ts',
    'lib/meta/capi.ts',
  ])
})

test('el Pixel ID y la activación se ven en el formulario principal, no plegados en avanzadas', async () => {
  const { INTEGRATION_GROUPS } = await import('../lib/integrations-catalog.ts')
  const meta = INTEGRATION_GROUPS.find((g) => g.id === 'meta')
  for (const key of ['META_PIXEL_ID', 'META_CAPI_ENABLED']) {
    const f = meta.fields.find((x) => x.key === key)
    assert.ok(f, `${key} no está en el catálogo`)
    assert.ok(!f.advanced && !f.hidden, `${key} no debe estar oculto ni en avanzadas`)
  }
})

test('la pantalla de Integraciones tiene el botón de prueba de la CAPI y llama a la ruta correcta', () => {
  const p = readFileSync('app/[tenant]/settings/integraciones/page.tsx', 'utf8')
  assert.match(p, /integraciones\/meta-capi-test/)
  assert.match(p, /Probar la Conversions API/)
  assert.match(p, /\^TEST\[A-Za-z0-9\]\{1,30\}\$/)
})
