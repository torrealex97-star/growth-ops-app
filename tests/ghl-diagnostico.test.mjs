import assert from 'node:assert/strict'
import test from 'node:test'
import { diagnosticarGhl, estadoDeHttp, redesConectadas, resumenDiagnostico } from '../lib/ghl/diagnostico.ts'

const resp = (status, cuerpo = {}) => ({ status, json: async () => cuerpo })

test('el estado sale del código HTTP', () => {
  assert.equal(estadoDeHttp(200), 'ok')
  assert.equal(estadoDeHttp(401), 'sin_permiso')
  assert.equal(estadoDeHttp(403), 'sin_permiso')
  assert.equal(estadoDeHttp(404), 'no_disponible')
  assert.equal(estadoDeHttp(500), 'error')
})

test('solo se exponen los nombres de las redes, nunca cuentas ni ids', () => {
  const j = {
    results: {
      accounts: [
        { platform: 'Instagram', id: 'x1', name: 'Mi cuenta' },
        { platform: 'tiktok' },
        { platform: 'instagram' },
      ],
    },
  }
  assert.equal(redesConectadas(j), 'instagram, tiktok')
  assert.equal(redesConectadas({ results: { accounts: [] } }), 'ninguna red conectada')
  assert.equal(redesConectadas({}), 'ninguna red conectada')
})

test('diagnóstico: solo GET, token en cabecera, una sonda por área y un fallo no tumba las demás', async () => {
  const vistos = []
  const f = async (url, init) => {
    vistos.push({ url, metodo: init.method ?? 'GET', auth: init.headers.Authorization })
    if (url.includes('/social-media-posting/')) return resp(200, { results: { accounts: [{ platform: 'tiktok' }] } })
    if (url.includes('/conversations/')) return resp(403)
    if (url.includes('/opportunities/')) throw new Error('red')
    return resp(200)
  }
  const caps = await diagnosticarGhl({ token: 'pit-secreto', locationId: 'LOC/1', fetchImpl: f })
  assert.equal(caps.length, 5)
  assert.ok(vistos.every((v) => v.metodo === 'GET' && v.auth === 'Bearer pit-secreto'))
  assert.ok(
    vistos.every((v) => !v.url.includes('pit-secreto')),
    'el token no va en la URL'
  )
  assert.ok(
    vistos.some((v) => v.url.includes('LOC%2F1')),
    'el locationId se codifica'
  )
  const por = Object.fromEntries(caps.map((c) => [c.id, c]))
  assert.equal(por.contactos.estado, 'ok')
  assert.equal(por.conversaciones.estado, 'sin_permiso')
  assert.equal(por.oportunidades.estado, 'error')
  assert.equal(por.redes_sociales.detalle, 'tiktok')
  const txt = resumenDiagnostico(caps)
  assert.match(txt, /Redes conectadas en GHL: tiktok/)
  assert.match(txt, /Conversaciones \(sin permiso\)/)
  assert.doesNotMatch(txt, /pit-secreto/)
})
