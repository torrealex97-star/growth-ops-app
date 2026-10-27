// ACCESO A UN REGISTRO CONCRETO (cita, venta) CUANDO LA RUTA USA SERVICE-ROLE.
//
// El cliente service-role se salta el RLS: una ruta que lee/escribe «la cita X» por id solo con el filtro de subcuenta
// deja que CUALQUIER miembro (un afiliado, un editor) toque la cita o la venta de otra persona con solo conocer el id.
// Este predicado repite en servidor la regla de visibilidad del RLS (liderazgo, visibilidad de equipo o ser el setter /
// el closer de la fila) para esas rutas.

export const LIDERAZGO = ['admin', 'director', 'manager'] as const
const ROLES_COMERCIALES = ['closer', 'setter', 'cold_caller'] as const

export type FilaConResponsables = { setter_id: string | null; closer_id: string | null }

export function puedeAccederAFila(
  quien: { userId: string; role: string | null; isSuperAdmin: boolean; dataScope: string | null },
  fila: FilaConResponsables
): boolean {
  if (quien.isSuperAdmin) return true
  const rol = quien.role ?? ''
  if ((LIDERAZGO as readonly string[]).includes(rol)) return true
  if (!(ROLES_COMERCIALES as readonly string[]).includes(rol)) return false
  if (quien.dataScope === 'team') return true
  return fila.setter_id === quien.userId || fila.closer_id === quien.userId
}

/** Roles que pueden ver contratos ajenos (misma lista que la política `contracts_select` del RLS). */
export const ROLES_VER_CONTRATOS = ['admin', 'director', 'manager', 'gestoria', 'csm'] as const
