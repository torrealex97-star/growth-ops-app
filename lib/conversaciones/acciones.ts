// ACCIONES SOBRE UNA CONVERSACIÓN (puro): qué puede hacer cada rol y qué cambia.
// La ruta del servidor solo autentica, llama a esto, escribe el parche y deja la auditoría: las reglas viven
// aquí para probarlas sin base de datos.

import { siguienteEstado, esEstado, type Estado } from './estados'

export type Accion =
  | { tipo: 'resolver' }
  | { tipo: 'reabrir' }
  | { tipo: 'aplazar'; hasta: string }
  | { tipo: 'asignar'; usuarioId: string | null }
  | { tipo: 'etiquetas'; etiquetas: string[] }
  | { tipo: 'modo_ia'; modo: 'off' | 'borrador' | 'autonomo' }
  | { tipo: 'traspasar' }

export type FilaAccion = {
  status: string
  snoozed_until: string | null
  ai_mode: string
  labels: string[]
  assignee_id: string | null
}

export type ResultadoAccion =
  | { ok: true; parche: Record<string, unknown>; evento: { kind: string; data: Record<string, unknown> } }
  | { ok: false; status: 400 | 403; error: string }

/** Quién trabaja las conversaciones, y quién puede tocar el modo de la IA (lo más sensible). */
export const ROLES_GESTION = ['admin', 'director', 'manager', 'marketing', 'setter'] as const
export const ROLES_IA = ['admin', 'director'] as const

const MAX_ETIQUETAS = 12
const ETIQUETA = /^[\p{L}\p{N}][\p{L}\p{N} _-]{0,29}$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function limpiarEtiquetas(entrada: unknown): string[] | null {
  if (!Array.isArray(entrada) || entrada.length > MAX_ETIQUETAS) return null
  const out: string[] = []
  for (const e of entrada) {
    if (typeof e !== 'string') return null
    const t = e.trim().toLowerCase()
    if (!ETIQUETA.test(t)) return null
    if (!out.includes(t)) out.push(t)
  }
  return out
}

export function aplicarAccion(
  fila: FilaAccion,
  accion: Accion,
  rol: string,
  ahora: Date = new Date()
): ResultadoAccion {
  if (!(ROLES_GESTION as readonly string[]).includes(rol)) return { ok: false, status: 403, error: 'No autorizado' }
  const actual = {
    estado: (esEstado(fila.status) ? fila.status : 'abierta') as Estado,
    aplazadaHasta: fila.snoozed_until,
  }
  const cambioEstado = (
    tipo: 'resolver' | 'reabrir' | 'traspaso_a_humano' | 'aplazar',
    hasta?: string
  ): ResultadoAccion => {
    const sig = siguienteEstado(actual, tipo === 'aplazar' ? { tipo, hasta: hasta ?? '' } : { tipo }, ahora)
    if (sig.estado === actual.estado && tipo === 'aplazar')
      return { ok: false, status: 400, error: 'La fecha para aplazar debe ser futura' }
    return {
      ok: true,
      parche: { status: sig.estado, snoozed_until: sig.aplazadaHasta },
      evento: { kind: 'estado', data: { de: actual.estado, a: sig.estado, accion: tipo } },
    }
  }
  switch (accion.tipo) {
    case 'resolver':
      return cambioEstado('resolver')
    case 'reabrir':
      return cambioEstado('reabrir')
    case 'traspasar': {
      // Traspaso manual a una persona: la IA deja de actuar en esa conversación.
      const r = cambioEstado('traspaso_a_humano')
      return r.ok ? { ...r, parche: { ...r.parche, ai_mode: 'off' } } : r
    }
    case 'aplazar':
      return cambioEstado('aplazar', accion.hasta)
    case 'asignar':
      if (accion.usuarioId !== null && !UUID.test(accion.usuarioId))
        return { ok: false, status: 400, error: 'Usuario no válido' }
      return {
        ok: true,
        parche: { assignee_id: accion.usuarioId },
        evento: { kind: 'asignacion', data: { de: fila.assignee_id, a: accion.usuarioId } },
      }
    case 'etiquetas': {
      const limpias = limpiarEtiquetas(accion.etiquetas)
      if (!limpias) return { ok: false, status: 400, error: 'Etiquetas no válidas' }
      return {
        ok: true,
        parche: { labels: limpias },
        evento: { kind: 'etiquetas', data: { de: fila.labels, a: limpias } },
      }
    }
    case 'modo_ia': {
      if (!(ROLES_IA as readonly string[]).includes(rol))
        return { ok: false, status: 403, error: 'Solo administración cambia el modo de la IA' }
      if (!['off', 'borrador', 'autonomo'].includes(accion.modo))
        return { ok: false, status: 400, error: 'Modo no válido' }
      // Activar la IA deja la conversación en «pendiente» (la atiende la IA); apagarla la devuelve a una persona.
      const estado: Estado =
        accion.modo === 'off' ? (actual.estado === 'pendiente' ? 'abierta' : actual.estado) : 'pendiente'
      return {
        ok: true,
        parche: { ai_mode: accion.modo, status: estado, snoozed_until: null },
        evento: { kind: 'modo_ia', data: { de: fila.ai_mode, a: accion.modo } },
      }
    }
    default:
      return { ok: false, status: 400, error: 'Acción no válida' }
  }
}

/** Valida el cuerpo de la petición y lo convierte en una `Accion`; `null` si no es válido. */
export function leerAccion(cuerpo: unknown): Accion | null {
  if (typeof cuerpo !== 'object' || cuerpo === null) return null
  const c = cuerpo as Record<string, unknown>
  switch (c.accion) {
    case 'resolver':
    case 'reabrir':
    case 'traspasar':
      return { tipo: c.accion }
    case 'aplazar':
      return typeof c.hasta === 'string' && Number.isFinite(Date.parse(c.hasta))
        ? { tipo: 'aplazar', hasta: new Date(c.hasta).toISOString() }
        : null
    case 'asignar':
      return c.usuarioId === null || typeof c.usuarioId === 'string'
        ? { tipo: 'asignar', usuarioId: c.usuarioId }
        : null
    case 'etiquetas':
      return Array.isArray(c.etiquetas) ? { tipo: 'etiquetas', etiquetas: c.etiquetas as string[] } : null
    case 'modo_ia':
      return c.modo === 'off' || c.modo === 'borrador' || c.modo === 'autonomo'
        ? { tipo: 'modo_ia', modo: c.modo }
        : null
    default:
      return null
  }
}
