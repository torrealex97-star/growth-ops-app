import assert from 'node:assert/strict'
import test from 'node:test'

import { autorizarPlataforma, MATRIZ_PERMISOS_PLATAFORMA } from '../lib/platform/rbac.ts'

const staff = (accion, extra = {}) => autorizarPlataforma({ esSuperAdmin: true, ...extra, accion })

// §27.1 — un admin de SU subcuenta (rol comercial) no es staff de plataforma.
test('un admin de subcuenta no puede ejecutar ninguna acción de plataforma', () => {
  for (const accion of Object.keys(MATRIZ_PERMISOS_PLATAFORMA.admin)) {
    const d = autorizarPlataforma({ esSuperAdmin: false, accion })
    assert.equal(d.autorizado, false, `la acción ${accion} debe denegarse a no-staff`)
    assert.match(d.motivo, /no_es_staff/)
  }
})

// §27.8 — sin sesión de staff no hay enumeración ni fallback permisivo.
test('sin flag real de super admin listar_tenants también queda denegado', () => {
  const d = autorizarPlataforma({ esSuperAdmin: false, accion: 'listar_tenants' })
  assert.deepEqual(d, { autorizado: false, motivo: 'no_es_staff' })
})

// El único staff que existe hoy ejerce «admin de plataforma» sin rol declarado.
test('el super admin binario de hoy puede listar tenants y consultar la auditoría', () => {
  const listar = staff('listar_tenants')
  assert.equal(listar.autorizado, true)
  assert.equal(listar.alcance, 'total')
  const audit = staff('consultar_auditoria_plataforma')
  assert.equal(audit.autorizado, true)
  assert.equal(audit.alcance, 'total')
})

// Regla 13/14/15 — cambios de suscripción, suspensiones y reactivaciones no existen como flujo
// trazable: el super admin de HOY también queda denegado, con el motivo que lo explica.
test('cambiar entitlements, suspender y reactivar exigen flujo de aprobación que aún no existe', () => {
  for (const accion of ['cambiar_entitlements', 'suspender_tenant', 'reactivar_tenant']) {
    const d = staff(accion)
    assert.equal(d.autorizado, false)
    assert.match(d.motivo, /_exige_flujo_de_aprobacion/, `ojo: motivo de ${accion}`)
  }
})

// §27.22 — el acceso a datos sensibles nunca es implícito: ni siquiera para el dueño.
test('acceso_excepcional_datos está denegado para todos los roles, incluido el dueño', () => {
  for (const rol of Object.keys(MATRIZ_PERMISOS_PLATAFORMA)) {
    const d = staff('acceso_excepcional_datos', { rolDeclarado: rol })
    assert.equal(d.autorizado, false, `el rol ${rol} no debe tener acceso excepcional implícito`)
    assert.match(d.motivo, /acceso_excepcional_requiere_flujo/)
  }
})

// «Un hueco no es un cero": mientras no haya billing propio, ver suscripción se deniega con
// motivo de fuente ausente (no un plan inventado ni datos vacíos).
test('ver_suscripcion_tenant se deniega con motivo de fuente ausente en lugar de datos vacíos', () => {
  const d = staff('ver_suscripcion_tenant')
  assert.equal(d.autorizado, false)
  assert.equal(d.motivo, 'fuente_de_suscripcion_ausente')
})

// El motor de tickets no existe (grep 0): la acción se deniega en vez de fingir vacíos.
test('consultar_tickets se deniega mientras no exista el motor de tickets', () => {
  const d = staff('consultar_tickets')
  assert.equal(d.autorizado, false)
  assert.equal(d.motivo, 'motor_de_tickets_ausente')
})

// El rol declarado RESTRINGE: un auditor declarado pierde el listado total del admin binario.
test('el rol declarado restringe quién accede al listado completo', () => {
  const d = staff('listar_tenants', { rolDeclarado: 'auditor' })
  assert.equal(d.autorizado, true)
  assert.equal(d.alcance, 'limitado')
})

// §27.15 — rol inventado o corrupto (root, god_mode, falsificaciones) ⇒ deny por defecto.
test('cualquier rol no reconocido queda denegado aunque sea staff', () => {
  const d = staff('listar_tenants', { rolDeclarado: 'root' })
  assert.deepEqual(d, { autorizado: false, motivo: 'rol_desconocido' })
})
