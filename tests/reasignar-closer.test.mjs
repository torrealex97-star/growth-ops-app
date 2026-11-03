import assert from 'node:assert/strict'
import test from 'node:test'
import { closerDeLaSubcuenta, proveedorDeReasignacion } from '../lib/appointments/closer.ts'
import { reasignarCloserApi } from '../lib/appointments/reasignar-cliente.ts'
import { GhlReasignarError, reasignarCitaGhl } from '../lib/ghl/reasignar.ts'

const ahora = new Date('2026-11-03T10:00:00Z')

test('proveedor: GHL → ghl; Calendly futura → calendly; Calendly pasada o manual → solo la app', () => {
  assert.equal(
    proveedorDeReasignacion(
      { external_source: 'ghl', external_id: 'e1', calendly_event_uuid: null, appointment_datetime: null },
      ahora
    ),
    'ghl'
  )
  const cal = { external_source: 'calendly', external_id: 'x', calendly_event_uuid: 'u1' }
  assert.equal(proveedorDeReasignacion({ ...cal, appointment_datetime: '2026-11-05T10:00:00Z' }, ahora), 'calendly')
  assert.equal(proveedorDeReasignacion({ ...cal, appointment_datetime: '2026-11-01T10:00:00Z' }, ahora), 'solo_app')
  assert.equal(
    proveedorDeReasignacion(
      {
        external_source: 'manual',
        external_id: null,
        calendly_event_uuid: null,
        appointment_datetime: '2026-11-05T10:00:00Z',
      },
      ahora
    ),
    'solo_app'
  )
})

// Cliente Supabase mínimo: devuelve la fila de users y la de tenant_members que se le indiquen.
const sbFalso = ({ user, miembro }) => ({
  from: (tabla) => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: tabla === 'users' ? user : miembro }) }
    return q
  },
})

test('closer: debe ser closer/admin Y miembro de la subcuenta (users no tiene tenant_id)', async () => {
  const user = { id: 'c1', email: 'a@x.com', calendly_email: null, full_name: 'A', roles: { key: 'closer' } }
  assert.ok(await closerDeLaSubcuenta(sbFalso({ user, miembro: { id: 'm' } }), 't', 'c1'))
  assert.equal(await closerDeLaSubcuenta(sbFalso({ user, miembro: null }), 't', 'c1'), null, 'de otra subcuenta')
  assert.ok(await closerDeLaSubcuenta(sbFalso({ user, miembro: null }), 't', 'c1', true), 'super admin')
  assert.equal(
    await closerDeLaSubcuenta(
      sbFalso({ user: { ...user, roles: { key: 'setter' } }, miembro: { id: 'm' } }),
      't',
      'c1'
    ),
    null
  )
})

const resp = (status, cuerpo = {}) => ({ ok: status < 300, status, json: async () => cuerpo })

test('GHL: busca al usuario por email y cambia assignedUserId; sin permiso lo explica', async () => {
  const llamadas = []
  const f = async (url, init) => {
    llamadas.push([url, init?.method ?? 'GET', init?.body])
    return url.includes('/users/') ? resp(200, { users: [{ id: 'g9', email: 'Closer@X.com' }] }) : resp(200)
  }
  await reasignarCitaGhl({
    token: 't',
    locationId: 'L',
    eventId: 'ev1',
    emails: ['otro@x.com', 'closer@x.com'],
    fetchImpl: f,
  })
  assert.equal(llamadas[1][0], 'https://services.leadconnectorhq.com/calendars/events/appointments/ev1')
  assert.equal(llamadas[1][1], 'PUT')
  assert.deepEqual(JSON.parse(llamadas[1][2]), { assignedUserId: 'g9' })

  const sinPermiso = async (url) =>
    url.includes('/users/') ? resp(200, { users: [{ id: 'g9', email: 'closer@x.com' }] }) : resp(403)
  await assert.rejects(
    reasignarCitaGhl({ token: 't', locationId: 'L', eventId: 'ev1', emails: ['closer@x.com'], fetchImpl: sinPermiso }),
    (e) => e instanceof GhlReasignarError && /permiso/.test(e.message)
  )
  await assert.rejects(
    reasignarCitaGhl({ token: 't', locationId: 'L', eventId: 'ev1', emails: ['nadie@x.com'], fetchImpl: f }),
    /no tiene usuario en GHL/
  )
})

test('cliente: la cita de Calendly pide confirmar y reagenda con el closer nuevo; si se cancela no toca nada', async () => {
  const peticiones = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    peticiones.push([String(url).split('/appointments/')[1], JSON.parse(init.body)])
    return String(url).endsWith('reassign-closer')
      ? resp(409, {
          code: 'CALENDLY_REQUIERE_REAGENDAR',
          startTime: '2026-11-05T10:00:00Z',
          error: 'Calendly no permite…',
        })
      : resp(200, { ok: true })
  }
  try {
    const r = await reasignarCloserApi('t', 'a1', 'c2', () => true)
    assert.equal(r.sincronizado, 'calendly')
    assert.deepEqual(peticiones[1], [
      'reschedule',
      { appointmentId: 'a1', startTime: '2026-11-05T10:00:00Z', closerId: 'c2' },
    ])
    peticiones.length = 0
    const c = await reasignarCloserApi('t', 'a1', 'c2', () => false)
    assert.equal(c.cancelado, true)
    assert.equal(peticiones.length, 1, 'cancelar no llama a reschedule')
  } finally {
    globalThis.fetch = original
  }
})
