// SPEC-16 — Autorización de PLATAFORMA (staff), separada de los roles comerciales de tenant.
//
// Modelo real del repo (auditado en docs/SAAS_ADMIN_ARCHITECTURE_AUDIT.md §1):
//   · Solo existe UN rol de plataforma: `is_super_admin()` — flag binario en `tenant_members.role`
//     que da acceso total a todas las subcuentas (ver migración 20260911140000).
//   · `platform_staff_memberships` (Admin / Support / CS / Billing / Auditor) NO existe todavía:
//     llega en PR-1 cuando el dueño apruebe la jerarquía de la matriz.
//
// Reglas innegociables que este módulo codifica (SPEC-16 §1):
//   · Fail-closed: sin staff resuelto en servidor, NADA está permitido (§27.1 y §27.8).
//   · Nunca implícito: «acceso excepcional a datos» requiere un mecanismo explícito que hoy no
//     existe ⇒ denegado para todos, incluido super admin (§18/§27.22).
//   · No se improvisan atajos financieros: cambiar entitlements, suspender o reactivar una
//     subcuenta exige flujo de aprobación + auditoría que NO existe ⇒ denegado (§27.13/§27.15).
//   · «Un hueco no es un cero»: ver suscripción está denegado con motivo de fuente ausente,
//     porque inventar un plan fabricaría datos comerciales que no hay.
//   · El rol declarado RESTRINGE, nunca amplía: quien tenga además un rol de menor capacidad se
//     ejerce ese (espejo del `resolverRol` de requireTenant).
//
// Módulo PURO y determinista: sin BD, sin red, sin LLM. Los consumidores de PR-1 lo llaman con
// `esSuperAdmin` resuelto en servidor (`rpc('is_super_admin')`) y `rolDeclarado` leído de la
// tabla de staff memberships que llegue — JAMÁS de un input del cliente.

export type RolPlataforma = 'owner' | 'admin' | 'soporte' | 'cs' | 'billing' | 'auditor'

export type AccionPlataforma =
  | 'listar_tenants'
  | 'ver_estado_operativo'
  | 'ver_suscripcion_tenant'
  | 'cambiar_entitlements'
  | 'consultar_tickets'
  | 'suspender_tenant'
  | 'reactivar_tenant'
  | 'consultar_auditoria_plataforma'
  | 'acceso_excepcional_datos'

/** Alcance de una autorización. «limitado» = permitido SOLO con proyección mínima y scope restringido. */
export type AlcancePlataforma = 'total' | 'limitado'

export type DecisionPlataforma =
  { autorizado: true; alcance: AlcancePlataforma; motivo: string } | { autorizado: false; motivo: string }

type PermisosPorRol = Record<AccionPlataforma, AlcancePlataforma | 'denegado'>

/**
 * Matriz de la SPEC (§6 de SPEC-16) concretada v0: lo que la SPEC marca «restringido» o «según
 * política» se deniega MIENTRAS no exista el flujo de aprobación/auditoría que exige cada regla.
 * Denegar lo que todavía no se puede hacer DE FORMA TRAZABLE es fail-closed, no un recorte de scope.
 */
export const MATRIZ_PERMISOS_PLATAFORMA: Record<RolPlataforma, PermisosPorRol> = {
  owner: {
    listar_tenants: 'total',
    ver_estado_operativo: 'total',
    ver_suscripcion_tenant: 'denegado', // sin billing propio (SPEC-13), mostrar plan sería inventarlo
    cambiar_entitlements: 'denegado', // exige flujo de aprobación que no existe aún
    consultar_tickets: 'denegado', // no existen tickets de plataforma (grep 0)
    suspender_tenant: 'denegado', // §27.13: suspensión SIN aprobación prohibida
    reactivar_tenant: 'denegado', // §27.14: sin flujo de reactivación, denegada igual
    consultar_auditoria_plataforma: 'total',
    acceso_excepcional_datos: 'denegado', // §18: nunca implícito, ni para el dueño
  },
  admin: {
    listar_tenants: 'total',
    ver_estado_operativo: 'total',
    ver_suscripcion_tenant: 'denegado', // sin billing propio (SPEC-13), mostrar plan sería inventarlo
    cambiar_entitlements: 'denegado',
    consultar_tickets: 'denegado',
    suspender_tenant: 'denegado', // Requiere aprobación (flujo de PR-1+)
    reactivar_tenant: 'denegado',
    consultar_auditoria_plataforma: 'total',
    acceso_excepcional_datos: 'denegado', // «acceso excepcional»: requiere motivo y trazado nuevo
  },
  soporte: {
    listar_tenants: 'limitado', // solo listado básico (id/slug/name/status), sin configuración
    ver_estado_operativo: 'total',
    ver_suscripcion_tenant: 'denegado', // igual: fuente ausente hasta PR-3
    cambiar_entitlements: 'denegado',
    consultar_tickets: 'denegado',
    suspender_tenant: 'denegado',
    reactivar_tenant: 'denegado',
    consultar_auditoria_plataforma: 'limitado', // solo actas de ESA subcuenta asignada
    acceso_excepcional_datos: 'denegado',
  },
  cs: {
    listar_tenants: 'limitado', // solo subcuentas asignadas
    ver_estado_operativo: 'total',
    ver_suscripcion_tenant: 'denegado', // igual: fuente ausente hasta PR-3
    cambiar_entitlements: 'denegado',
    consultar_tickets: 'denegado',
    suspender_tenant: 'denegado',
    reactivar_tenant: 'denegado',
    consultar_auditoria_plataforma: 'limitado',
    acceso_excepcional_datos: 'denegado',
  },
  billing: {
    listar_tenants: 'limitado',
    ver_estado_operativo: 'limitado',
    ver_suscripcion_tenant: 'denegado', // sin billing propio (SPEC-13), mostrar plan sería inventarlo
    cambiar_entitlements: 'denegado', // «según política» de PR-3, no implementado
    consultar_tickets: 'denegado',
    suspender_tenant: 'denegado',
    reactivar_tenant: 'denegado',
    consultar_auditoria_plataforma: 'limitado',
    acceso_excepcional_datos: 'denegado',
  },
  auditor: {
    listar_tenants: 'limitado', // lectura
    ver_estado_operativo: 'limitado', // lectura
    ver_suscripcion_tenant: 'denegado', // igual: fuente ausente hasta PR-3
    cambiar_entitlements: 'denegado',
    consultar_tickets: 'denegado',
    suspender_tenant: 'denegado',
    reactivar_tenant: 'denegado',
    consultar_auditoria_plataforma: 'total',
    acceso_excepcional_datos: 'denegado',
  },
}

const ROLES_PLATAFORMA_VALIDOS = new Set<string>(Object.keys(MATRIZ_PERMISOS_PLATAFORMA))

export type ConsultaAccion = {
  /** Resultado de `rpc('is_super_admin')` resuelto EN SERVIDOR. Nunca del cliente. */
  esSuperAdmin: boolean
  /** Rol declarado en staff memberships desde PR-1. Hoy: siempre null (solo existe super_admin). */
  rolDeclarado?: RolPlataforma | null
  accion: AccionPlataforma
}

/**
 * Única puerta de decisión de autorización de plataforma. Corte doble:
 *   1) STAFF: hay que ser staff de plataforma en servidor — el binario de hoy (`is_super_admin`) es
 *      lo único que resuelve sin PR-1.
 *   2) ROL: el permiso sale de la matriz y del rol ejercido; el rol declarado restringe.
 * Lo que la SPEC pide y TODAVÍA no está implementado ⇒ denegado con motivo concreto
 */
export function autorizarPlataforma({ esSuperAdmin, rolDeclarado, accion }: ConsultaAccion): DecisionPlataforma {
  // §27.1: usuario de tenant de una subcuenta no es staff de plataforma, aunque sea su admin.
  if (!esSuperAdmin) {
    return { autorizado: false, motivo: 'no_es_staff' }
  }

  // Rol corrupto o inventado ⇒ deny (fail-closed contra cualquier key falsificada).
  if (rolDeclarado && !ROLES_PLATAFORMA_VALIDOS.has(rolDeclarado)) {
    return { autorizado: false, motivo: 'rol_desconocido' }
  }

  // El binario vigente ejerce «admin de plataforma»: PR-1 lo sustituirá por memberships reales.
  const rolEjercido: RolPlataforma = rolDeclarado ?? 'admin'
  const permiso = MATRIZ_PERMISOS_PLATAFORMA[rolEjercido][accion]

  if (permiso === 'denegado') {
    // Motivos diferenciados para que el 403 explique el porqué real.
    if (accion === 'acceso_excepcional_datos') return { autorizado: false, motivo: 'acceso_excepcional_requiere_flujo' }
    if (accion === 'ver_suscripcion_tenant') return { autorizado: false, motivo: 'fuente_de_suscripcion_ausente' }
    if (accion === 'consultar_tickets') return { autorizado: false, motivo: 'motor_de_tickets_ausente' }
    return { autorizado: false, motivo: `${accion}_exige_flujo_de_aprobacion` }
  }
  return { autorizado: true, alcance: permiso, motivo: `rol:${rolEjercido}` }
}
