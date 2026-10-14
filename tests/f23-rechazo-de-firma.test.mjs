import assert from 'node:assert/strict'
import test from 'node:test'
import { saludWebhook } from '../lib/data-health/webhooks.ts'

const ahora = Date.parse('2026-10-14T12:00:00Z')
const base = { proveedor: 'stripe', configurado: true, ahora }

test('envíos rechazados por firma recientes son un fallo confirmado, no un silencio', () => {
  const r = saludWebhook({ ...base, ultimoSobre: '2026-10-10T00:00:00Z', ultimoRechazo: '2026-10-14T10:00:00Z' })
  assert.equal(r.estado, 'rechazo')
  assert.match(r.mensaje, /firma inválida/)
})

test('rechazo sin ningún sobre válido nunca: también es rechazo', () => {
  const r = saludWebhook({ ...base, ultimoSobre: null, ultimoRechazo: '2026-10-14T11:00:00Z' })
  assert.equal(r.estado, 'rechazo')
})

test('si después del rechazo llegó un sobre válido, el rechazo ya no manda', () => {
  const r = saludWebhook({ ...base, ultimoSobre: '2026-10-14T11:30:00Z', ultimoRechazo: '2026-10-14T10:00:00Z' })
  assert.equal(r.estado, 'al_dia')
})

test('un rechazo viejo (más de 24 h) no tiñe de rojo: queda el silencio, que es ámbar', () => {
  const r = saludWebhook({ ...base, ultimoSobre: '2026-10-01T00:00:00Z', ultimoRechazo: '2026-10-05T00:00:00Z' })
  assert.equal(r.estado, 'silencio')
})

test('sin integración configurada o evidencia ilegible el rechazo no se afirma', () => {
  assert.equal(
    saludWebhook({ ...base, configurado: false, ultimoSobre: null, ultimoRechazo: '2026-10-14T11:00:00Z' }).estado,
    'sin_configurar'
  )
  assert.equal(
    saludWebhook({ ...base, leido: false, ultimoSobre: null, ultimoRechazo: '2026-10-14T11:00:00Z' }).estado,
    'desconocido'
  )
})
