// RESPUESTAS RÁPIDAS DE LA BANDEJA (puro): textos reutilizables por subcuenta. Se guardan como JSON en
// `integration_settings` (clave `conversaciones_respuestas_rapidas`, sin secretos) y se LEEN siempre por
// `leerRespuestasRapidas`, que nunca confía en lo guardado.
//
// Las respuestas rápidas las inserta una PERSONA en el cuadro de respuesta y las revisa antes de enviar: no pasan
// por el agente de IA ni se envían solas. `{{nombre}}` se sustituye por el nombre de pila del contacto.

export const CLAVE_RESPUESTAS_RAPIDAS = 'conversaciones_respuestas_rapidas'
export const MAX_RESPUESTAS = 30
export const MAX_TITULO = 40
export const MAX_TEXTO_RESPUESTA = 1000

/** Quién puede editar las plantillas compartidas. Todos los de gestión las pueden USAR. */
export const ROLES_EDITAR_RESPUESTAS = ['admin', 'director', 'manager', 'marketing'] as const

export type RespuestaRapida = { id: string; titulo: string; texto: string }

const cadena = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

function idDe(titulo: string, usados: Set<string>): string {
  const base =
    titulo
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || 'respuesta'
  let id = base
  for (let i = 2; usados.has(id); i++) id = `${base}-${i}`
  usados.add(id)
  return id
}

export function leerRespuestasRapidas(guardado: unknown): RespuestaRapida[] {
  let j: unknown = guardado
  if (typeof guardado === 'string') {
    try {
      j = JSON.parse(guardado)
    } catch {
      return []
    }
  }
  if (!Array.isArray(j)) return []
  const usados = new Set<string>()
  const salida: RespuestaRapida[] = []
  for (const r of j.slice(0, MAX_RESPUESTAS)) {
    if (typeof r !== 'object' || r === null) continue
    const titulo = cadena((r as Record<string, unknown>).titulo, MAX_TITULO)
    const texto = cadena((r as Record<string, unknown>).texto, MAX_TEXTO_RESPUESTA)
    if (!titulo || !texto) continue
    salida.push({ id: idDe(titulo, usados), titulo, texto })
  }
  return salida
}

export function aGuardableRespuestas(entrada: unknown): string {
  return JSON.stringify(leerRespuestasRapidas(entrada))
}

/** Sustituye `{{nombre}}` por el nombre de pila (o lo quita si no se conoce). */
export function rellenarRespuesta(texto: string, nombreCompleto: string | null | undefined): string {
  const pila = (nombreCompleto ?? '').trim().split(/\s+/)[0] ?? ''
  return texto
    .replace(/\{\{\s*nombre\s*\}\}/gi, pila)
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/ {2,}/g, ' ')
    .slice(0, MAX_TEXTO_RESPUESTA)
}
