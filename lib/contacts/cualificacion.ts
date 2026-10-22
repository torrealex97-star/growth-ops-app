// CUALIFICACIÓN DE UN CONTACTO (pura): cómo se combinan las respuestas nuevas de un formulario con las que
// la persona ya tenía (Calendly, otro formulario). Compartida por Typeform y por el módulo de Formularios.

type Json = Record<string, unknown>
const esObjeto = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Combina la cualificación NUEVA con la que el contacto ya tenía. Lo nuevo gana en las claves que
 * trae; lo que Typeform no preguntó (y Calendly sí) se conserva. Las `respuestas` se unen sin repetir
 * la misma pregunta: gana la más reciente.
 */
export function fusionarCualificacion(
  previa: Record<string, unknown> | null | undefined,
  nueva: Record<string, unknown>
): Record<string, unknown> {
  const base = previa && esObjeto(previa) ? previa : {}
  const resultado: Record<string, unknown> = { ...base, ...nueva }
  const previas = Array.isArray(base.respuestas) ? (base.respuestas as { q: string; a: string }[]) : []
  const nuevas = Array.isArray(nueva.respuestas) ? (nueva.respuestas as { q: string; a: string }[]) : []
  const preguntasNuevas = new Set(nuevas.map((r) => r.q.trim().toLowerCase()))
  resultado.respuestas = [...previas.filter((r) => !preguntasNuevas.has(r.q.trim().toLowerCase())), ...nuevas]
  return resultado
}
