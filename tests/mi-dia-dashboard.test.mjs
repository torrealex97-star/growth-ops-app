import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { columnaDeMisCitas, resumenMiDia } from '../lib/dashboard/mi-dia.ts'
import { allowedPrefixesFor } from '../lib/auth/permissions.ts'
import { makeNavFilter } from '../lib/nav.ts'

const ahora = new Date('2026-10-15T10:00:00Z') // 12:00 en Madrid
const cita = (id, iso, status = 'scheduled') => ({ id, appointment_datetime: iso, status, contacto: id })

test('hoy, por marcar y próximas 7 días salen de las citas propias', () => {
  const r = resumenMiDia(
    [
      cita('hoy-tarde', '2026-10-15T15:00:00Z'),
      cita('hoy-mañana-pasada', '2026-10-15T07:00:00Z'), // ya pasó hoy y sin marcar
      cita('ayer-sin-marcar', '2026-10-14T10:00:00Z', 'confirmed'),
      cita('ayer-marcada', '2026-10-14T11:00:00Z', 'show'),
      cita('cancelada', '2026-10-16T10:00:00Z', 'cancelled'),
      cita('en-3-dias', '2026-10-18T10:00:00Z'),
      cita('en-20-dias', '2026-11-04T10:00:00Z'),
    ],
    ahora
  )
  assert.deepEqual(
    r.hoy.map((c) => c.id),
    ['hoy-mañana-pasada', 'hoy-tarde']
  )
  assert.deepEqual(
    r.porMarcar.map((c) => c.id),
    ['hoy-mañana-pasada', 'ayer-sin-marcar']
  )
  assert.deepEqual(
    r.proximas7.map((c) => c.id),
    ['en-3-dias']
  )
})

test('cada rol mira su columna; los demás roles no tienen «mis citas»', () => {
  assert.equal(columnaDeMisCitas('closer'), 'closer_id')
  assert.equal(columnaDeMisCitas('setter'), 'setter_id')
  assert.equal(columnaDeMisCitas('cold_caller'), 'cold_caller_id')
  assert.equal(columnaDeMisCitas('affiliate'), null)
  assert.equal(columnaDeMisCitas('admin'), null)
})

test('un closer con páginas a medida SIGUE viendo su Dashboard (caso Danielle)', () => {
  const aMedida = ['/crm/agendas', '/ventas/registro', '/comisiones']
  assert.ok(allowedPrefixesFor('closer', null, aMedida)?.includes('/dashboard'))
  assert.ok(allowedPrefixesFor('setter', null, aMedida)?.includes('/dashboard'))
  assert.ok(allowedPrefixesFor('affiliate', null, aMedida)?.includes('/dashboard'))
  const filtro = makeNavFilter('closer', null, aMedida)
  assert.equal(filtro({ label: 'Dashboard', href: '/dashboard', icon: () => null, roles: ['closer'] }), true)
})

test('el inicio personal no se regala a roles que no lo tienen', () => {
  assert.equal(allowedPrefixesFor('cobros', null, ['/ventas/pagos'])?.includes('/dashboard'), false)
  assert.equal(allowedPrefixesFor('csm', null, ['/students'])?.includes('/dashboard'), false)
})

test('el dashboard monta «Mi día» solo para quien no es liderazgo', () => {
  const p = readFileSync(new URL('../app/[tenant]/dashboard/page.tsx', import.meta.url), 'utf8')
  assert.match(p, /!isLeadership\(myRoleKey\) && tenantId && \(/)
  assert.match(p, /<MiDia tenant=\{tenant\}/)
})

test('el <main> con scroll es `relative`: contiene los sr-only y no alarga el documento', () => {
  const l = readFileSync(new URL('../app/[tenant]/layout.tsx', import.meta.url), 'utf8')
  assert.match(l, /<main className="relative flex-1 overflow-y-auto/)
})
