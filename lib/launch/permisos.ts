// Quién puede GESTIONAR los lanzamientos de una subcuenta (programar, abrir, cerrar, editar
// contenido, checklist e informes guardados). Una sola definición para todas las rutas.
//
// Antes cada ruta comprobaba `['admin','director'].includes(auth.role)`. `role` es el rol FUNCIONAL
// (global), así que quien administra la subcuenta (`tenant_members.role` admin, o super_admin de
// plataforma) con otro rol funcional —o sin ninguno— recibía un 403 en su propia subcuenta.
// `administraTenant` es justo esa respuesta y ya viene resuelta en requireTenant().

export type AuthLanzamiento = { role: string | null; administraTenant: boolean }

export function puedeGestionarLanzamiento(auth: AuthLanzamiento): boolean {
  return auth.administraTenant || auth.role === 'admin' || auth.role === 'director'
}

export const MOTIVO_SOLO_LECTURA =
  'Solo quien administra la subcuenta (o un director) puede cambiar los lanzamientos. Tú puedes consultarlos.'
