/**
 * Presets de rol: qué debe quedar puesto AL DAR DE ALTA a un usuario, para que nadie tenga que marcarlo
 * a mano. Módulo puro (sin BD ni React): lo usan la API de invitación, el alta de colaboradores y la
 * pantalla de usuarios, así que el "alta estándar" vive en UN solo sitio.
 *
 * Qué pantallas ve cada rol NO se define aquí: eso es `ROLE_ALLOWED_PREFIXES` en `lib/auth/permissions.ts`.
 * Este módulo solo fija los valores de la fila (`users`, `tenant_members`, `collaborator_profiles`).
 */

/** Roles que necesitan un `tracking_code` para generar enlaces con UTM / referido. */
export const TRACKING_ROLES: readonly string[] = ['setter', 'closer', 'cold_caller', 'affiliate']

export interface PresetRol {
  /**
   * Visibilidad de datos. El default de la BD es 'team' (abre las políticas RLS de equipo): para un
   * colaborador externo el valor correcto es 'own' (mínimo privilegio). El scope real de colaborador
   * sigue saliendo de `collaborator_profiles`, que es más estrecho todavía.
   */
  dataScope: 'own' | 'team'
  /** Vinculado a `docs/MONEY.md` D9: el preset NUNCA desactiva comisiones (purgaría las no liquidadas). */
  paysCommissions: true
  /** Dominio canónico de `users.member_status` ('activo' | 'inactivo' | 'prueba'). */
  memberStatus: 'activo'
  /** Rol de membresía en la subcuenta. Los roles elevados (admin/director) no pasan por aquí. */
  membershipRole: 'member'
  /** Si debe nacer con ficha en `collaborator_profiles` (es lo que activa su dashboard estándar). */
  fichaColaborador: { estadoInicial: 'invited' } | null
  /** Clave de plantilla de contrato de equipo asociada al rol. */
  contratoRoleKey: string | null
}

const PRESETS: Readonly<Record<string, PresetRol>> = {
  affiliate: {
    dataScope: 'own',
    paysCommissions: true,
    memberStatus: 'activo',
    membershipRole: 'member',
    fichaColaborador: { estadoInicial: 'invited' },
    contratoRoleKey: 'affiliate',
  },
}

/** Preset del rol, o `null` si el rol no tiene alta estándar propia (se comporta como hasta ahora). */
export function presetDeRol(roleKey: string | null | undefined): PresetRol | null {
  if (!roleKey) return null
  return PRESETS[roleKey] ?? null
}

export function necesitaTrackingCode(roleKey: string | null | undefined): boolean {
  return !!roleKey && TRACKING_ROLES.includes(roleKey)
}

/** Normaliza un % de comisión escrito por una persona: vacío, no numérico o fuera de 0-100 → `null`. */
export function normalizarPorcentaje(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  const n = typeof valor === 'number' ? valor : parseFloat(String(valor).replace(',', '.'))
  if (!Number.isFinite(n) || n < 0 || n > 100) return null
  return n
}
