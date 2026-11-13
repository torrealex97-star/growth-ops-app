import assert from 'node:assert/strict'
import test from 'node:test'
import { leerConversiones } from '../lib/launch/conversiones.ts'
import { leerPaginado } from '../lib/launch/filas.ts'
import { agregarPanel, leadDetalle, leadsACsv, limpiarBusqueda } from '../lib/launch/panel.ts'
import { puedeGestionarLanzamiento } from '../lib/launch/permisos.ts'
import { sbMemoria } from './fixtures/sb-memoria.mjs'

// Fila CON LA FORMA REAL de PostgREST: columnas de contact_launches en el primer nivel y `contacts`
// anidado. El panel devolvía 500 con un solo lead porque leía `f.contact_launches.created_at`.
const fila = (o = {}) => ({
  id: 'cl-1',
  created_at: '2026-11-02T10:00:00Z',
  confirmed_at: null,
  utm: { utm_content: 'Anuncio A', utm_campaign: 'Campaña 1' },
  contact_id: 'c-1',
  contacts: { full_name: 'Persona Uno', email: 'uno@ejemplo.com', phone: '+34600000001', qualification: null },
  ...o,
})

test('el panel se calcula con UNA fila real sin lanzar (regresión del 500)', () => {
  const r = agregarPanel([fila()], { total: 1, confirmados: 0, truncado: false, conversiones: null })
  assert.equal(r.metricas.leads, 1)
  assert.equal(r.metricas.muestraCompleta, true)
  assert.deepEqual(r.dias, [{ fecha: '2026-11-02', leads: 1, confirmados: 0 }])
  assert.equal(r.recientes[0].nombre, 'Persona Uno')
  assert.equal(r.recientes[0].anuncio, 'Anuncio A')
  assert.equal(r.recientes[0].fecha, '2026-11-02T10:00:00Z')
})

test('sin cruce de agendas/ventas las conversiones son HUECO (null), no cero', () => {
  const r = agregarPanel([fila()], { total: 1, confirmados: 0, truncado: false, conversiones: null })
  assert.equal(r.metricas.agendaron, null)
  assert.equal(r.metricas.compraron, null)
  assert.equal(r.recientes[0].agendo, null)
})

test('con cruce leído, citas y ventas son reales por lead y por anuncio', () => {
  const filas = ['a', 'b', 'c', 'd'].map((x, i) =>
    fila({ id: `cl-${x}`, contact_id: `c-${x}`, confirmed_at: i === 0 ? '2026-11-03T10:00:00Z' : null })
  )
  const conversiones = {
    conCita: new Set(['c-a', 'c-b', 'c-ajeno']),
    conVenta: new Set(['c-a']),
    agendasLeidas: true,
    ventasLeidas: true,
  }
  const r = agregarPanel(filas, { total: 4, confirmados: 1, truncado: false, conversiones })
  assert.equal(r.metricas.agendaron, 2, 'no cuenta contactos que no son de este lanzamiento')
  assert.equal(r.metricas.compraron, 1)
  assert.equal(r.anuncios[0].anuncio, 'Anuncio A')
  assert.equal(r.anuncios[0].citas, 2)
  assert.equal(r.anuncios[0].ventas, 1)
  assert.equal(r.anuncios[0].confirmados, 1)
})

test('si una lectura falla, solo ESE dato queda como hueco', () => {
  const conversiones = { conCita: new Set(['c-1']), conVenta: new Set(), agendasLeidas: true, ventasLeidas: false }
  const r = agregarPanel([fila()], { total: 1, confirmados: 0, truncado: false, conversiones })
  assert.equal(r.metricas.agendaron, 1)
  assert.equal(r.metricas.compraron, null)
})

test('una muestra cortada se declara: nunca se da por completa', () => {
  const r = agregarPanel([fila()], { total: 2400, confirmados: 10, truncado: true, conversiones: null })
  assert.equal(r.metricas.muestraCompleta, false)
  assert.equal(r.metricas.leads, 2400, 'el total viene del conteo en Postgres, no de la muestra')
  assert.equal(r.metricas.filasLeidas, 1)
  const corta = agregarPanel([fila()], { total: 5, confirmados: 0, truncado: false, conversiones: null })
  assert.equal(corta.metricas.muestraCompleta, false, 'menos filas que el total también es muestra parcial')
})

test('leerPaginado supera el tope de filas de PostgREST y avisa si se agota el máximo', async () => {
  const filas = Array.from({ length: 2500 }, (_, i) => ({ id: String(i).padStart(5, '0'), tenant_id: 'T' }))
  const { sb } = sbMemoria({ t: filas }, { maxRows: 1000 })
  const directa = await sb.from('t').select('id').eq('tenant_id', 'T').limit(5000)
  assert.equal(directa.data.length, 1000, 'el .limit(5000) de antes se quedaba en 1000 sin avisar')

  const pagina = (a, b) => sb.from('t').select('id').eq('tenant_id', 'T').order('id', { ascending: true }).range(a, b)
  const todo = await leerPaginado(pagina, { max: 5000 })
  assert.equal(todo.filas.length, 2500)
  assert.equal(todo.truncado, false)
  assert.equal(new Set(todo.filas.map((f) => f.id)).size, 2500, 'sin repetir ni saltar filas')

  const tope = await leerPaginado(pagina, { max: 2000 })
  assert.equal(tope.filas.length, 2000)
  assert.equal(tope.truncado, true)

  const justo = await leerPaginado(pagina, { max: 2500 })
  assert.equal(justo.truncado, true, 'al agotar el máximo no se puede asegurar que no haya más')
})

test('conversiones: una reserva sin completar no es venta (D8) y nada cruza de subcuenta', async () => {
  const { sb } = sbMemoria({
    appointments: [
      { id: 'a1', tenant_id: 'T', contact_id: 'c1', status: 'scheduled', created_at: '2026-11-05T00:00:00Z' },
      { id: 'a2', tenant_id: 'T', contact_id: 'c2', status: 'cancelled', created_at: '2026-11-05T00:00:00Z' },
      { id: 'a3', tenant_id: 'T', contact_id: 'c3', status: 'scheduled', created_at: '2026-10-01T00:00:00Z' },
      { id: 'a4', tenant_id: 'OTRO', contact_id: 'c4', status: 'scheduled', created_at: '2026-11-05T00:00:00Z' },
    ],
    sales: [
      {
        id: 's1',
        tenant_id: 'T',
        contact_id: 'c1',
        status: 'active',
        created_at: '2026-11-06T00:00:00Z',
        reservation_completed_at: null,
        payment_plans: { method: 'transferencia' },
      },
      {
        id: 's2',
        tenant_id: 'T',
        contact_id: 'c2',
        status: 'active',
        created_at: '2026-11-06T00:00:00Z',
        reservation_completed_at: null,
        payment_plans: { method: 'reserva' },
      },
      {
        id: 's3',
        tenant_id: 'T',
        contact_id: 'c3',
        status: 'active',
        created_at: '2026-11-06T00:00:00Z',
        reservation_completed_at: '2026-11-07T00:00:00Z',
        payment_plans: [{ method: 'reserva' }],
      },
      {
        id: 's4',
        tenant_id: 'T',
        contact_id: 'c4',
        status: 'refunded',
        created_at: '2026-11-06T00:00:00Z',
        reservation_completed_at: null,
        payment_plans: null,
      },
      {
        id: 's5',
        tenant_id: 'OTRO',
        contact_id: 'c4',
        status: 'active',
        created_at: '2026-11-06T00:00:00Z',
        reservation_completed_at: null,
        payment_plans: null,
      },
    ],
  })
  const c = await leerConversiones(sb, 'T', ['c1', 'c2', 'c3', 'c4'], '2026-11-01T00:00:00Z')
  assert.deepEqual([...c.conCita].sort(), ['c1'], 'ni cancelada, ni anterior al lanzamiento, ni de otra subcuenta')
  assert.deepEqual([...c.conVenta].sort(), ['c1', 'c3'], 'la reserva abierta de c2 no cuenta; la completada de c3 sí')
  assert.equal(c.agendasLeidas && c.ventasLeidas, true)
})

test('conversiones: un error de lectura deja el dato como no leído, no como cero', async () => {
  const { sb } = sbMemoria({ appointments: [], sales: [] }, { errores: { sales: { select: { message: 'boom' } } } })
  const c = await leerConversiones(sb, 'T', ['c1'], '2026-11-01T00:00:00Z')
  assert.equal(c.agendasLeidas, true)
  assert.equal(c.ventasLeidas, false)
})

test('detalle del lead: respuestas de la encuesta tal cual y desglose solo si hay nota', () => {
  const sin = leadDetalle(fila())
  assert.equal(sin.quality, null)
  assert.equal(sin.desglose, null)
  assert.deepEqual(sin.respuestas, [])
  const con = leadDetalle(
    fila({
      contacts: {
        full_name: 'P',
        email: null,
        phone: null,
        qualification: { respuestas: [{ q: '¿Qué edad tienes?', a: '30' }, { q: 'vacía', a: '  ' }, null] },
      },
    })
  )
  assert.deepEqual(con.respuestas, [{ q: '¿Qué edad tienes?', a: '30' }])
})

test('la búsqueda se limpia de sintaxis de filtro antes de llegar a PostgREST', () => {
  assert.equal(limpiarBusqueda('  ana,email.ilike.*  '), 'ana email.ilike.')
  assert.equal(limpiarBusqueda('a)or(1'), 'a or 1')
  assert.equal(limpiarBusqueda(null), '')
  assert.equal(limpiarBusqueda('x'.repeat(200)).length, 60)
})

test('CSV: escapa separadores y neutraliza fórmulas de hoja de cálculo', () => {
  const csv = leadsACsv([
    {
      id: '1',
      nombre: '=HYPERLINK("http://x")',
      email: 'a;b@ejemplo.com',
      phone: '+34600000000',
      fecha: '2026-11-02T10:00:00Z',
      confirmado: true,
      anuncio: 'Con "comillas"',
      campana: null,
      quality: 7.5,
      agendo: null,
      compro: false,
    },
  ])
  const [cabecera, linea] = csv.split('\r\n')
  assert.match(cabecera, /^Nombre;Email;Teléfono/)
  assert.match(linea, /^"'=HYPERLINK\(""http:\/\/x""\)";"a;b@ejemplo.com";'\+34600000000;/)
  assert.match(linea, /;sí;7.5;;no;"Con ""comillas""";$/)
})

test('gestionar lanzamientos: quien administra la subcuenta puede aunque su rol funcional no sea admin', () => {
  assert.equal(puedeGestionarLanzamiento({ role: null, administraTenant: true }), true)
  assert.equal(puedeGestionarLanzamiento({ role: 'closer', administraTenant: true }), true)
  assert.equal(puedeGestionarLanzamiento({ role: 'director', administraTenant: false }), true)
  assert.equal(puedeGestionarLanzamiento({ role: 'manager', administraTenant: false }), false)
  assert.equal(puedeGestionarLanzamiento({ role: 'marketing', administraTenant: false }), false)
  assert.equal(puedeGestionarLanzamiento({ role: null, administraTenant: false }), false)
})
