import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { TRACKER_JS, TRACKER_JS_VERSION } from '../lib/tracking/tracker-js.ts'

test('el pixel envía como text/plain: sin preflight CORS en iOS/WebKit (el tráfico de anuncios)', () => {
  // Con application/json, sendBeacon entre dominios exige preflight y falla en silencio en WebKit.
  assert.match(TRACKER_JS, /type: 'text\/plain;charset=UTF-8'/)
  assert.match(TRACKER_JS, /'Content-Type': 'text\/plain;charset=UTF-8'/)
  assert.doesNotMatch(TRACKER_JS, /application\/json/)
  assert.notEqual(TRACKER_JS_VERSION, '1.1.0')
})

test('el endpoint de ingesta no depende del Content-Type: lee el texto y lo parsea', () => {
  const s = readFileSync(new URL('../app/api/track/[site]/route.ts', import.meta.url), 'utf8')
  assert.match(s, /await request\.text\(\)/)
  assert.match(s, /JSON\.parse\(rawBody\)/)
  assert.doesNotMatch(s, /request\.json\(\)/)
})
