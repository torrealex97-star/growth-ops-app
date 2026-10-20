import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TRACKER_JS, TRACKER_JS_VERSION } from '../lib/tracking/tracker-js.ts'
import { sanitizarFbc, sanitizarFbp } from '../lib/tracking/meta-click.ts'

test('el tracker es JavaScript válido y sube de versión', () => {
  assert.doesNotThrow(() => new Function(TRACKER_JS))
  assert.equal(TRACKER_JS_VERSION, '1.3.1')
})

test('el Pixel de Meta es opt-in: solo con data-meta-pixel numérico y sin gopNoMeta', () => {
  assert.match(TRACKER_JS, /getAttribute\('data-meta-pixel'\)/)
  assert.match(TRACKER_JS, /\^\[0-9\]\{8,20\}\$/)
  assert.match(TRACKER_JS, /!window\.gopNoMeta/)
  assert.equal((TRACKER_JS.match(/connect\.facebook\.net/g) ?? []).length, 1)
})

test('el Pixel y el servidor comparten el mismo event_id (deduplicación)', () => {
  assert.match(TRACKER_JS, /mirrorToPixel\(event, payload\.event_id\)/)
  assert.match(TRACKER_JS, /\{ eventID: eventId \}/)
})

test('solo se reflejan los eventos con equivalente estándar de Meta', () => {
  assert.match(TRACKER_JS, /page_view: 'PageView', lead: 'Lead', appointment_booked: 'Schedule', purchase: 'Purchase'/)
})

test('fbc/fbp se mandan con cada evento y el fbc se arma desde el fbclid', () => {
  assert.match(TRACKER_JS, /payload\.fbp = /)
  assert.match(TRACKER_JS, /payload\.fbc = /)
  assert.match(TRACKER_JS, /'fb\.1\.' \+ Date\.now\(\) \+ '\.' \+ attrs\.fbclid/)
})

test('el servidor solo acepta fbc/fbp con el formato de Meta', () => {
  assert.equal(sanitizarFbc('fb.1.1700000000123.AbC-123_x'), 'fb.1.1700000000123.AbC-123_x')
  assert.equal(sanitizarFbc('fb.1.123.x'), null)
  assert.equal(sanitizarFbc('<script>'), null)
  assert.equal(sanitizarFbc(42), null)
  assert.equal(sanitizarFbp('fb.1.1700000000123.1234567890'), 'fb.1.1700000000123.1234567890')
  assert.equal(sanitizarFbp('fb.1.1700000000123.abc'), null)
})

test('la ingesta guarda fbc/fbp saneados en sesión y evento canónico', () => {
  const n = readFileSync('lib/tracking/normalizar.ts', 'utf8')
  assert.match(n, /fbc: sanitizarFbc\(body\.fbc\)/)
  assert.match(n, /fbp: sanitizarFbp\(body\.fbp\)/)
  assert.equal((n.match(/sanitizarFbc\(body\.fbc\)/g) ?? []).length, 2)
})

test('el panel solo añade data-meta-pixel con un ID numérico', () => {
  const p = readFileSync('components/settings/TrackingSitesPanel.tsx', 'utf8')
  assert.match(p, /\^\\d\{8,20\}\$/)
  assert.match(p, /data-meta-pixel=/)
})

test('la cookie _fbc solo se escribe con el Pixel activo y el valor es estable entre eventos', () => {
  assert.match(TRACKER_JS, /if \(pixelReady\) \{\s+try \{\s+document\.cookie = '_fbc='/)
  assert.match(TRACKER_JS, /if \(!memFbc\) memFbc = /)
})
