/**
 * SOP de una lección: un ENLACE a un documento (Google Docs, Notion, PDF…) con un nombre. Se abre en pestaña nueva,
 * no se incrusta, así que basta con exigir https y rechazar credenciales en la URL. Módulo puro.
 */

export const MAX_SOPS_POR_LECCION = 10

export type SopValidado = { ok: true; url: string; titulo: string } | { ok: false }

export function validarSop(url: unknown, titulo: unknown): SopValidado {
  if (typeof url !== 'string' || typeof titulo !== 'string') return { ok: false }
  const nombre = titulo.trim()
  if (nombre.length < 1 || nombre.length > 120) return { ok: false }
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    return { ok: false }
  }
  if (u.protocol !== 'https:' || u.username || u.password) return { ok: false }
  const href = u.toString()
  if (href.length > 600) return { ok: false }
  return { ok: true, url: href, titulo: nombre }
}
