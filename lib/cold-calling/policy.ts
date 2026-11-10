// Quién es quién en cold calling. Una sola definición para rutas, pantallas y menú.
//
//   · caller  — llama a los leads que tiene asignados. Solo ve y toca los suyos.
//   · gestor  — supervisa al equipo: reparte, reasigna, ve la actividad y las comisiones de todas.
//               Es el manager de cold calling, el liderazgo de ventas o quien administra la
//               subcuenta. El manager de cold calling NO recibe por ello permisos de dirección.
//   · ajustes — los tramos de comisión son dinero: solo quien administra la subcuenta o un director.

export type AuthColdCalling = { role: string | null; administraTenant: boolean }

export const ROL_CALLER = 'cold_caller'
export const ROL_MANAGER = 'cold_calling_manager'

const GESTORES = new Set(['admin', 'director', 'manager', ROL_MANAGER])

export const esCaller = (auth: AuthColdCalling): boolean => auth.role === ROL_CALLER

export const puedeGestionarColdCalling = (auth: AuthColdCalling): boolean =>
  auth.administraTenant || GESTORES.has(auth.role ?? '')

export const puedeConfigurarColdCalling = (auth: AuthColdCalling): boolean =>
  auth.administraTenant || auth.role === 'admin' || auth.role === 'director'

export const esUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

/** Error de negocio con mensaje para la persona (se responde 400, no 500). */
export class ErrorColdCalling extends Error {
  // Propiedad declarada a mano (sin "parameter property"): los tests cargan este fichero con el
  // type-stripping de Node, que no admite sintaxis que genere código.
  readonly status: 400 | 403 | 404 | 409
  constructor(message: string, status: 400 | 403 | 404 | 409 = 400) {
    super(message)
    this.name = 'ErrorColdCalling'
    this.status = status
  }
}
