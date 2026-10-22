import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { aplicarAccion, leerAccion, limpiarEtiquetas } from '../lib/conversaciones/acciones.ts'

const AHORA = new Date('2026-10-22T12:00:00Z')
const fila = (extra = {}) => ({
  status: 'abierta',
  snoozed_until: null,
  ai_mode: 'off',
  labels: [],
  assignee_id: null,
  ...extra,
})
const futuro = new Date(AHORA.getTime() + 3_600_000).toISOString()

test('resolver y reabrir cambian el estado y dejan constancia de la transición', () => {
  const r = aplicarAccion(fila(), { tipo: 'resolver' }, 'setter', AHORA)
  assert.equal(r.ok && r.parche.status, 'resuelta')
  assert.deepEqual(r.evento.data, { de: 'abierta', a: 'resuelta', accion: 'resolver' })
  assert.equal(
    aplicarAccion(fila({ status: 'resuelta' }), { tipo: 'reabrir' }, 'setter', AHORA).parche.status,
    'abierta'
  )
})

test('aplazar exige fecha futura', () => {
  assert.equal(aplicarAccion(fila(), { tipo: 'aplazar', hasta: futuro }, 'setter', AHORA).parche.status, 'aplazada')
  const pasado = aplicarAccion(
    fila(),
    { tipo: 'aplazar', hasta: new Date(AHORA.getTime() - 1000).toISOString() },
    'setter',
    AHORA
  )
  assert.equal(pasado.ok, false)
  assert.equal(pasado.status, 400)
})

test('solo admin y director cambian el modo de la IA; un setter no, y activarla deja la conversación pendiente', () => {
  assert.equal(aplicarAccion(fila(), { tipo: 'modo_ia', modo: 'autonomo' }, 'setter', AHORA).status, 403)
  assert.equal(aplicarAccion(fila(), { tipo: 'modo_ia', modo: 'autonomo' }, 'manager', AHORA).status, 403)
  const on = aplicarAccion(fila(), { tipo: 'modo_ia', modo: 'borrador' }, 'director', AHORA)
  assert.equal(on.ok && on.parche.ai_mode, 'borrador')
  assert.equal(on.parche.status, 'pendiente')
  const off = aplicarAccion(
    fila({ status: 'pendiente', ai_mode: 'autonomo' }),
    { tipo: 'modo_ia', modo: 'off' },
    'admin',
    AHORA
  )
  assert.equal(off.parche.status, 'abierta')
})

test('traspasar a una persona apaga la IA y deja la conversación abierta', () => {
  const r = aplicarAccion(fila({ status: 'pendiente', ai_mode: 'autonomo' }), { tipo: 'traspasar' }, 'setter', AHORA)
  assert.equal(r.parche.status, 'abierta')
  assert.equal(r.parche.ai_mode, 'off')
})

test('roles sin acceso a la gestión (closer, afiliado) no pueden hacer nada', () => {
  for (const rol of ['closer', 'affiliate', 'csm', ''])
    assert.equal(aplicarAccion(fila(), { tipo: 'resolver' }, rol, AHORA).status, 403)
})

test('etiquetas: se normalizan, se deduplican y se rechaza lo raro; asignar exige un uuid', () => {
  assert.deepEqual(limpiarEtiquetas([' VIP ', 'vip', 'Seguimiento']), ['vip', 'seguimiento'])
  assert.equal(limpiarEtiquetas(['<script>']), null)
  assert.equal(limpiarEtiquetas(Array.from({ length: 13 }, (_, i) => `e${i}`)), null)
  assert.equal(limpiarEtiquetas('x'), null)
  assert.equal(aplicarAccion(fila(), { tipo: 'asignar', usuarioId: 'no-uuid' }, 'setter', AHORA).status, 400)
  assert.equal(aplicarAccion(fila(), { tipo: 'asignar', usuarioId: null }, 'setter', AHORA).ok, true)
})

test('leerAccion solo acepta cuerpos válidos', () => {
  assert.deepEqual(leerAccion({ accion: 'resolver' }), { tipo: 'resolver' })
  assert.equal(leerAccion({ accion: 'aplazar', hasta: 'x' }), null)
  assert.equal(leerAccion({ accion: 'modo_ia', modo: 'dios' }), null)
  assert.equal(leerAccion({ accion: 'borrar_todo' }), null)
  assert.equal(leerAccion(null), null)
})

test('la ruta escribe con el rol del servidor, audita cada cambio y la pantalla está en el menú con permisos', () => {
  const r = readFileSync('app/api/[tenant]/evergreen/conversaciones/[id]/route.ts', 'utf8')
  assert.match(r, /requireTenant\(tenant\)/)
  assert.match(r, /aplicarAccion\(fila, accion, rol\)/)
  assert.match(r, /from\('conversation_events'\)\.insert/)
  assert.match(r, /\.eq\('tenant_id', sesion\.tenantId\)/)
  assert.match(readFileSync('lib/nav.ts', 'utf8'), /href: '\/conversaciones'/)
  assert.ok((readFileSync('lib/auth/permissions.ts', 'utf8').match(/'\/conversaciones'/g) ?? []).length >= 3)
})
