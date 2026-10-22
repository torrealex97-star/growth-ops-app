import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { calcularMetricas } from '../lib/conversaciones/metricas.ts'

const T = (min) => new Date(Date.UTC(2026, 9, 22, 10, min)).toISOString()
const conv = (id, contact_id = null) => ({ id, contact_id })
const msg = (conversation_id, direction, author, min) => ({ conversation_id, direction, author, sent_at: T(min) })

test('sin conversaciones no hay cifras inventadas: porcentajes y medianas son null, no cero', () => {
  const m = calcularMetricas([], [], [], [])
  assert.equal(m.conversaciones, 0)
  assert.equal(m.respondidas, null)
  assert.equal(m.primeraRespuestaMin.humano, null)
  assert.equal(m.primeraRespuestaMin.ia, null)
  assert.equal(m.traspasoPct, null)
  assert.equal(m.agendasPosteriores, 0)
})

test('respondidas y mediana de primera respuesta por quién respondió (persona o IA)', () => {
  const m = calcularMetricas(
    [conv('a'), conv('b'), conv('c'), conv('d')],
    [
      msg('a', 'entrante', 'lead', 0),
      msg('a', 'saliente', 'humano', 10),
      msg('b', 'entrante', 'lead', 0),
      msg('b', 'saliente', 'humano', 30),
      msg('c', 'entrante', 'lead', 0),
      msg('c', 'saliente', 'ia', 1),
      msg('d', 'entrante', 'lead', 0), // sin respuesta
    ],
    [],
    null
  )
  assert.equal(m.conversaciones, 4)
  assert.equal(m.respondidas, 75)
  assert.equal(m.primeraRespuestaMin.humano, 20)
  assert.equal(m.primeraRespuestaMin.ia, 1)
  assert.equal(m.atendidasPorIA, 1)
  assert.equal(m.agendasPosteriores, null, 'sin comprobar las citas queda «sin datos», no 0')
})

test('una conversación sin mensaje del lead (solo salientes) no cuenta como atendida', () => {
  const m = calcularMetricas([conv('a')], [msg('a', 'saliente', 'humano', 0)], [], [])
  assert.equal(m.conversaciones, 0)
  assert.equal(m.respondidas, null)
})

test('traspasos, motivos agrupados y % sobre lo que tocó el agente; borradores y envíos de la IA', () => {
  const m = calcularMetricas(
    [conv('a'), conv('b'), conv('c')],
    [
      msg('a', 'entrante', 'lead', 0),
      msg('a', 'saliente', 'ia', 1),
      msg('b', 'entrante', 'lead', 0),
      msg('c', 'entrante', 'lead', 0),
    ],
    [
      { conversation_id: 'b', kind: 'traspaso', data: { motivo: 'precio_o_condiciones' } },
      { conversation_id: 'c', kind: 'traspaso', data: { motivo: 'validacion: menciona precio o condiciones' } },
      { conversation_id: 'a', kind: 'ia_envio', data: {} },
      { conversation_id: 'a', kind: 'borrador', data: { estado: 'aprobado' } },
      { conversation_id: 'a', kind: 'borrador', data: { estado: 'pendiente' } },
      { conversation_id: 'a', kind: 'borrador', data: { estado: 'descartado' } },
    ],
    null
  )
  assert.equal(m.enviosIA, 1)
  assert.deepEqual(m.borradores, { pendientes: 1, aprobados: 1, descartados: 1 })
  assert.deepEqual(m.motivosTraspaso.map((x) => x.motivo).sort(), ['precio_o_condiciones', 'validacion'])
  // Tocó el agente: a (respondió), b y c (traspaso) → 2 de 3 traspasadas.
  assert.ok(Math.abs(m.traspasoPct - (2 / 3) * 100) < 1e-9)
})

test('eventos de conversaciones ajenas al periodo no se cuentan', () => {
  const m = calcularMetricas(
    [conv('a')],
    [msg('a', 'entrante', 'lead', 0)],
    [
      { conversation_id: 'otra', kind: 'ia_envio', data: {} },
      { conversation_id: 'otra', kind: 'traspaso', data: {} },
    ],
    null
  )
  assert.equal(m.enviosIA, 0)
  assert.equal(m.traspasoPct, null)
})

test('citas posteriores: solo las creadas DESPUÉS del primer mensaje y una vez por lead', () => {
  const m = calcularMetricas(
    [conv('a', 'ct1'), conv('b', 'ct2'), conv('c', 'ct1')],
    [msg('a', 'entrante', 'lead', 10), msg('b', 'entrante', 'lead', 10), msg('c', 'entrante', 'lead', 20)],
    [],
    [
      { contact_id: 'ct1', created_at: T(30) },
      { contact_id: 'ct1', created_at: T(40) },
      { contact_id: 'ct2', created_at: T(5) }, // anterior al primer mensaje: no es consecuencia
      { contact_id: null, created_at: T(50) },
    ]
  )
  assert.equal(m.agendasPosteriores, 1)
})

test('la ruta de métricas exige rol de gestión, acota la lectura y declara cuando es parcial', () => {
  const r = readFileSync('app/api/[tenant]/evergreen/conversaciones/metricas/route.ts', 'utf8')
  assert.match(r, /ROLES_GESTION as readonly string\[\]\)\.includes\(rol\)/)
  assert.match(r, /TOPE_CONVERSACIONES/)
  assert.match(r, /parcial/)
  assert.match(r, /\.eq\('tenant_id', sesion\.tenantId\)/)
  const p = readFileSync('app/[tenant]/conversaciones/MetricasTab.tsx', 'utf8')
  assert.match(p, /Sin datos/)
})

test('la pantalla de Conversaciones ofrece la pestaña de métricas y la ruta antigua redirige', () => {
  assert.match(readFileSync('app/[tenant]/conversaciones/page.tsx', 'utf8'), /metricas: \{ etiqueta: 'Métricas'/)
  assert.match(readFileSync('app/[tenant]/conversaciones/metricas/page.tsx', 'utf8'), /conversaciones\?tab=metricas/)
})
