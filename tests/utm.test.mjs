import { test } from 'node:test'
import assert from 'node:assert/strict'
import { construirUrlUtm, parametrosMeta, validarUrlUtm } from '../lib/tracking/utm.ts'

test('construye la URL con UTMs normalizadas y conserva los parámetros existentes', () => {
  const r = construirUrlUtm('https://x.com/oferta?ref=1', {
    source: 'Instagram ',
    medium: 'Paid Social',
    campaign: 'Lanzamiento Octubre',
    content: 'Video 1',
  })
  assert.ok(r.ok)
  const u = new URL(r.url)
  assert.equal(u.searchParams.get('ref'), '1')
  assert.equal(u.searchParams.get('utm_source'), 'instagram')
  assert.equal(u.searchParams.get('utm_medium'), 'paid-social')
  assert.equal(u.searchParams.get('utm_campaign'), 'lanzamiento-octubre')
  assert.equal(u.searchParams.get('utm_content'), 'video-1')
  assert.equal(u.searchParams.get('utm_term'), null)
})

test('rechaza URL inválida, protocolo raro y UTMs obligatorias vacías', () => {
  assert.equal(construirUrlUtm('no-url', { source: 'a', medium: 'b', campaign: 'c' }).ok, false)
  assert.equal(construirUrlUtm('javascript:alert(1)', { source: 'a', medium: 'b', campaign: 'c' }).ok, false)
  assert.equal(construirUrlUtm('https://x.com', { source: 'a', medium: ' ', campaign: 'c' }).ok, false)
})

test('los parámetros de Meta llevan las macros sin codificar y los IDs', () => {
  const p = parametrosMeta()
  assert.match(p, /utm_campaign=\{\{campaign\.name\}\}/)
  assert.match(p, /utm_content=\{\{ad\.name\}\}/)
  assert.match(p, /ad_id=\{\{ad\.id\}\}/)
  assert.ok(!p.includes('%7B'))
})

test('el validador marca lo que falta y lo que fragmenta fuentes', () => {
  const sin = validarUrlUtm('https://x.com/')
  assert.equal(sin.filter((a) => a.nivel === 'error').length, 3)
  const mayus = validarUrlUtm('https://x.com/?utm_source=Meta&utm_medium=cpc&utm_campaign=a&utm_content=b')
  assert.equal(mayus.length, 1)
  assert.match(mayus[0].mensaje, /mayúsculas/)
  assert.deepEqual(validarUrlUtm(`https://x.com/?${parametrosMeta()}`), [])
  assert.equal(validarUrlUtm('x')[0].nivel, 'error')
})
