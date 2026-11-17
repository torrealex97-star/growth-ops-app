/**
 * Recurso de apoyo de una lección (p. ej. el manual en un documento). Se abre como ENLACE en pestaña nueva,
 * no se incrusta, así que basta con exigir https y rechazar credenciales en la URL. Módulo puro.
 */

export type RecursoValidado = { ok: true; url: string | null; etiqueta: string | null } | { ok: false }

export function validarRecurso(url: unknown, etiqueta: unknown): RecursoValidado {
  const vacio = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
  if (vacio(url)) return { ok: true, url: null, etiqueta: null }
  if (typeof url !== 'string') return { ok: false }
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return { ok: false }
  }
  if (u.protocol !== 'https:' || u.username || u.password) return { ok: false }
  const href = u.toString()
  if (href.length > 600) return { ok: false }
  if (vacio(etiqueta)) return { ok: true, url: href, etiqueta: null }
  if (typeof etiqueta !== 'string' || etiqueta.trim().length > 80) return { ok: false }
  return { ok: true, url: href, etiqueta: etiqueta.trim() }
}
