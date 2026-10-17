import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contarSesionesPixel } from '../lib/tracking/sesiones.ts'

test('una recarga no es otra visita: se cuentan sesiones, no filas', () => {
  const r = contarSesionesPixel([
    { session_id: 's1', url: 'https://x.test/?utm_source=ig&fbclid=abc' },
    { session_id: 's1', url: 'https://x.test/?utm_source=ig&fbclid=abc' },
    { session_id: 's2', url: 'https://x.test/' },
  ])
  assert.equal(r.total, 2)
  assert.equal(r.ads, 1)
})

test('fbclid o utm de pago es anuncio; direct y bio no', () => {
  const r = contarSesionesPixel([
    { session_id: 'a', url: 'https://x.test/?fbclid=1' },
    { session_id: 'b', url: 'https://x.test/?utm_source=facebook&utm_medium=paid' },
    { session_id: 'c', url: 'https://x.test/?utm_source=IG&utm_medium=Bio' },
    { session_id: 'd', url: 'https://x.test/?utm_source=direct&utm_medium=none' },
    { session_id: 'e', url: null },
  ])
  assert.equal(r.total, 5)
  assert.equal(r.ads, 2)
})

test('una fila sin sesión cuenta como sesión propia y una URL rota no rompe', () => {
  const r = contarSesionesPixel([
    { session_id: null, url: 'https://x.test/?fbclid=1' },
    { session_id: null, url: 'http://[' },
  ])
  assert.equal(r.total, 2)
  assert.equal(r.ads, 1)
})
