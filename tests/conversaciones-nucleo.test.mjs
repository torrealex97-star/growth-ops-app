import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canalAutorizadoParaIA, estadoVentana, horasDeVentana } from '../lib/conversaciones/ventana.ts'
import { despertarAplazada, esEstado, siguienteEstado } from '../lib/conversaciones/estados.ts'
import { normalizarMensajeGhl, sinDuplicados, ultimoEntrante } from '../lib/conversaciones/ingesta.ts'

const AHORA = new Date('2026-10-22T12:00:00Z')
const hace = (h) => new Date(AHORA.getTime() - h * 3_600_000).toISOString()

test('ventana: la IA tiene 24 h en Instagram y un humano 7 días; nunca se escribe en frío', () => {
  assert.equal(horasDeVentana('instagram', 'ia'), 24)
  assert.equal(horasDeVentana('instagram', 'humano'), 24 * 7)
  assert.equal(horasDeVentana('tiktok', 'ia'), 48)
  assert.equal(estadoVentana('instagram', 'ia', hace(23), AHORA).abierta, true)
  assert.equal(estadoVentana('instagram', 'ia', hace(25), AHORA).abierta, false)
  // El mismo hueco de 25 h SÍ está abierto para una persona (etiqueta HUMAN_AGENT), nunca para la IA.
  assert.equal(estadoVentana('instagram', 'humano', hace(25), AHORA).abierta, true)
  assert.equal(estadoVentana('instagram', 'humano', hace(24 * 8), AHORA).abierta, false)
  assert.equal(estadoVentana('instagram', 'ia', null, AHORA).abierta, false)
  assert.equal(estadoVentana('instagram', 'ia', 'no-es-fecha', AHORA).abierta, false)
})

test('la IA solo actúa en Instagram y Facebook: TikTok queda fuera', () => {
  assert.equal(canalAutorizadoParaIA('instagram'), true)
  assert.equal(canalAutorizadoParaIA('facebook'), true)
  assert.equal(canalAutorizadoParaIA('tiktok'), false)
  assert.equal(canalAutorizadoParaIA('sms'), false)
})

test('estados: entrante reabre lo resuelto; la IA mantiene pendiente; traspaso pasa a abierta', () => {
  const sig = (e, ev) => siguienteEstado(e, ev, AHORA)
  assert.equal(sig({ estado: 'resuelta', aplazadaHasta: null }, { tipo: 'mensaje_entrante' }).estado, 'abierta')
  assert.equal(sig({ estado: 'pendiente', aplazadaHasta: null }, { tipo: 'mensaje_entrante' }).estado, 'pendiente')
  assert.equal(sig({ estado: 'abierta', aplazadaHasta: null }, { tipo: 'respuesta_ia' }).estado, 'pendiente')
  assert.equal(sig({ estado: 'pendiente', aplazadaHasta: null }, { tipo: 'traspaso_a_humano' }).estado, 'abierta')
  assert.equal(sig({ estado: 'pendiente', aplazadaHasta: null }, { tipo: 'respuesta_humana' }).estado, 'abierta')
  // Una respuesta sobre algo ya resuelto no lo reabre sola.
  assert.equal(sig({ estado: 'resuelta', aplazadaHasta: null }, { tipo: 'respuesta_ia' }).estado, 'resuelta')
})

test('aplazar exige una fecha futura y despierta al llegar', () => {
  const futuro = new Date(AHORA.getTime() + 3_600_000).toISOString()
  const a = siguienteEstado({ estado: 'abierta', aplazadaHasta: null }, { tipo: 'aplazar', hasta: futuro }, AHORA)
  assert.equal(a.estado, 'aplazada')
  assert.equal(
    siguienteEstado({ estado: 'abierta', aplazadaHasta: null }, { tipo: 'aplazar', hasta: hace(1) }, AHORA).estado,
    'abierta'
  )
  assert.equal(despertarAplazada(a, AHORA).estado, 'aplazada')
  assert.equal(despertarAplazada(a, new Date(AHORA.getTime() + 7_200_000)).estado, 'abierta')
  assert.ok(esEstado('pendiente') && !esEstado('otro'))
})

const entrante = (extra = {}) => ({
  messageId: 'm1',
  conversationId: 'c1',
  contactId: 'k1',
  direction: 'inbound',
  messageType: 'TYPE_INSTAGRAM',
  body: 'Hola, quiero info',
  dateAdded: '2026-10-22T11:00:00Z',
  ...extra,
})

test('ingesta: normaliza un mensaje entrante de GHL y no inventa lo que falta', () => {
  const m = normalizarMensajeGhl(entrante())
  assert.equal(m.canal, 'instagram')
  assert.equal(m.autor, 'lead')
  assert.equal(m.direccion, 'entrante')
  assert.equal(m.enviadoEn, '2026-10-22T11:00:00.000Z')
  assert.equal(normalizarMensajeGhl(entrante({ messageId: '' })), null)
  assert.equal(normalizarMensajeGhl(entrante({ conversationId: undefined })), null)
  assert.equal(normalizarMensajeGhl(entrante({ dateAdded: 'x' })), null)
  assert.equal(normalizarMensajeGhl(null), null)
  assert.match(normalizarMensajeGhl(entrante({ body: '' })).texto, /sin texto/)
})

test('ingesta: el eco de un envío de la app se marca como IA o humano, nunca como lead', () => {
  const propios = new Map([['m9', 'ia']])
  const eco = normalizarMensajeGhl(entrante({ messageId: 'm9', direction: 'outbound' }), propios)
  assert.equal(eco.autor, 'ia')
  assert.equal(eco.direccion, 'saliente')
  assert.equal(normalizarMensajeGhl(entrante({ messageId: 'm10', direction: 'outbound' }), propios).autor, 'humano')
})

test('ingesta idempotente: webhook y sincronización del mismo mensaje son una sola fila', () => {
  const a = normalizarMensajeGhl(entrante())
  const b = normalizarMensajeGhl(entrante({ messageId: 'm2', dateAdded: '2026-10-22T11:05:00Z' }))
  const nuevos = sinDuplicados([a, a, b], new Set(['m2']))
  assert.deepEqual(
    nuevos.map((m) => m.externalId),
    ['m1']
  )
  assert.equal(ultimoEntrante([a, b]), '2026-10-22T11:05:00.000Z')
  assert.equal(ultimoEntrante([]), null)
})

test('la migración aísla por subcuenta, limita la lectura por rol y no deja escribir directamente', () => {
  const sql = readFileSync('supabase/migrations/20261022100000_conversaciones.sql', 'utf8')
  for (const t of ['conversations', 'conversation_messages', 'conversation_events']) {
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`))
    assert.match(sql, new RegExp(`"${t}_tenant_isolation" on public\\.${t} as restrictive`))
  }
  assert.match(sql, /revoke insert, update, delete on public\.conversations/)
  assert.match(sql, /unique \(tenant_id, external_id\)/)
  assert.match(sql, /\(select public\.get_my_role\(\)\)/)
  assert.ok(!/to anon/.test(sql.replace(/revoke all on[^;]+from anon;/, '')), 'anon no tiene permisos')
})
