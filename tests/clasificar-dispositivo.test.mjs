import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyDevice } from '../lib/tracking/ingest.ts'

test('classifyDevice distingue móvil, tablet y escritorio y no inventa sin user-agent', () => {
  assert.equal(classifyDevice(null), null)
  assert.equal(classifyDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148'), 'movil')
  assert.equal(classifyDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36'), 'movil')
  assert.equal(classifyDevice('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'tablet')
  assert.equal(classifyDevice('Mozilla/5.0 (Linux; Android 13; SM-X700) Safari/537.36'), 'tablet')
  assert.equal(classifyDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120'), 'escritorio')
})
