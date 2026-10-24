import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { attributionBySource, funnelBySource } from '../lib/analytics.ts'

const atr = (contact_id, source, last, extra = {}) => ({
  contact_id,
  source,
  utm_source: source,
  utm_campaign: null,
  utm_content: null,
  is_primary: true,
  last_utm_source: last,
  ...extra,
})
const venta = (contact_id) => ({
  id: `v-${contact_id}`,
  contact_id,
  status: 'active',
  gross_amount: 1000,
  sale_date: '2026-10-01',
  reservation_completed_at: null,
})

test('el primer toque reparte por quien captó y el último por quien remató', () => {
  const atribuciones = [atr('a', 'instagram', 'email'), atr('b', 'instagram', 'instagram'), atr('c', 'google', 'email')]
  const args = [['a', 'b', 'c'], atribuciones, [venta('a')], []]
  const primer = funnelBySource(...args, 'primer')
  const ultimo = funnelBySource(...args, 'ultimo')
  const get = (rows, s) => rows.find((r) => r.source === s)
  assert.equal(get(primer, 'instagram').leads, 2)
  assert.equal(get(primer, 'instagram').sales, 1)
  assert.equal(get(primer, 'email'), undefined)
  assert.equal(get(ultimo, 'email').leads, 2)
  assert.equal(get(ultimo, 'email').sales, 1)
  assert.equal(get(ultimo, 'instagram').leads, 1)
})

test('sin último toque (o con uno de sistema como ghl) se usa el primero: no se inventa un canal', () => {
  const rows = funnelBySource(['a', 'b'], [atr('a', 'instagram', null), atr('b', 'tiktok', 'ghl')], [], [], 'ultimo')
  assert.deepEqual(rows.map((r) => r.source).sort(), ['instagram', 'tiktok'])
})

test('el modelo por defecto es el primer toque (nada cambia para quien no toca el selector)', () => {
  const a = [atr('a', 'instagram', 'email')]
  assert.deepEqual(funnelBySource(['a'], a, [], []), funnelBySource(['a'], a, [], [], 'primer'))
})

test('la pantalla ofrece el selector y recalcula sin volver a pedir datos', () => {
  const p = readFileSync('app/[tenant]/marketing/adquisicion/atribucion/page.tsx', 'utf8')
  assert.match(p, /aria-label="Modelo de atribución"/)
  assert.match(p, /\[funnelInputs, modelo, colabNombres\]/)
  // La atribución estructurada de colaborador manda en la etiqueta: sin collaborator_id en el
  // select ni el mapa de nombres, un contacto de colaboradora se escondería tras el canal crudo.
  assert.match(p, /collaborator_id,first_utm_source/)
  assert.match(p, /from\('collaborator_profiles'\)/)
})

test('un contacto de colaboradora se nombra como «Colaboradora: <nombre>», no como su canal crudo', () => {
  // La atribución estructurada (contact_attributions.collaborator_id) ES quién trajo al lead:
  // esconderla tras «instagram» borra de las métricas el trabajo de la colaboradora.
  const atribucion = [
    atr('a', 'instagram', null),
    atr('b', 'instagram', null, { collaborator_id: 'colab-1' }),
    atr('c', 'ficha', null, { collaborator_id: 'colab-desconocido' }),
  ]
  const nombres = new Map([['colab-1', 'Ana']])
  const filas = funnelBySource(['a', 'b', 'c'], atribucion, [], [], 'primer', { nombresColaboradora: nombres })
  const get = (s) => filas.find((r) => r.source === s)
  assert.equal(get('Colaboradora: Ana').leads, 1, 'con nombre legible, la fila lleva su nombre')
  assert.equal(
    get('Colaboradora').leads,
    1,
    'sin nombre legible queda «Colaboradora»: la relación es cierta, no se inventa'
  )
  assert.equal(get('instagram').leads, 1, 'el contacto SIN colaborador mantiene su canal tal cual')

  const ventas = attributionBySource(['a', 'b'], atribucion, [venta('b')], { nombresColaboradora: nombres })
  assert.equal(ventas.find((r) => r.source === 'Colaboradora: Ana').sales, 1)
  assert.equal(ventas.find((r) => r.source === 'instagram').leads, 1)
})

test('sin opts nada cambia (compatibilidad con consumidores que no pasan nombres)', () => {
  const a = [atr('a', 'instagram', null, { collaborator_id: 'colab-1' })]
  const filas = funnelBySource(['a'], a, [], [])
  assert.equal(filas.length, 1)
  assert.equal(filas[0].source, 'Colaboradora')
})
