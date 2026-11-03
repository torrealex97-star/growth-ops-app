import type { HistoriaSpec } from './layouts'
import { textoDeHistoria } from './revision'

// VARIANTES CON IA de UNA historia (sin pasar por el chat): 3 ganchos, otra versión o una más corta. La IA solo propone
// texto; lo aplica la persona y se recompone con la plantilla. Puro: el prompt y la lectura de la respuesta.

export const MODOS_VARIANTE = ['ganchos', 'otra', 'corta'] as const
export type ModoVariante = (typeof MODOS_VARIANTE)[number]
export type Variante = { titulo?: string; acento?: string; texto?: string }

const INSTRUCCION: Record<ModoVariante, string> = {
  ganchos:
    'Escribe 3 GANCHOS distintos para esta historia, de máximo 8 palabras: uno de curiosidad, uno de contraste («lo que todos hacen vs lo que funciona») y una pregunta incómoda. Nada de clichés («descubre», «secreto»).',
  otra: 'Escribe 3 versiones alternativas del MISMO mensaje con otras palabras y otro ángulo, de la misma longitud.',
  corta: 'Escribe 3 versiones más CORTAS del mismo mensaje: titular de máximo 8 palabras y texto de máximo 12.',
}

export function construirPromptVariantes(p: {
  modo: ModoVariante
  spec: HistoriaSpec
  /** Titulares del resto de la secuencia, para no repetir ideas. */
  resto: string[]
  contexto?: string | null
  posicion: number
  total: number
}): { system: string; user: string } {
  const system = `Eres copywriter de historias de Instagram y TikTok. Escribes en español de España, tuteo, frases cortas, como habla la persona.
Reglas:
- No inventes cifras, resultados, testimonios ni plazas.
- Sin promesas de ingresos garantizados.
- «acento» es UNA palabra o frase corta que aparece literalmente en el titular.
- Responde SOLO con un array JSON de 3 objetos {"titulo": "...", "acento": "...", "texto": "..."} (texto es opcional). Sin explicaciones.`
  const user = [
    p.contexto?.trim() ? `Negocio:\n${p.contexto.trim().slice(0, 1500)}\n` : '',
    `Historia ${p.posicion} de ${p.total} (plantilla ${p.spec.layout}). Texto actual: «${textoDeHistoria(p.spec) || '(vacío)'}»`,
    p.resto.length ? `Resto de la secuencia (no repitas estas ideas): ${p.resto.map((t) => `«${t}»`).join(', ')}` : '',
    INSTRUCCION[p.modo],
  ]
    .filter(Boolean)
    .join('\n')
  return { system, user }
}

const limpio = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined)

/** Lee la respuesta de la IA aunque venga con ```json o con texto alrededor. Devuelve como mucho 3 variantes con contenido. */
export function leerVariantes(texto: string): Variante[] {
  const ini = texto.indexOf('[')
  const fin = texto.lastIndexOf(']')
  if (ini < 0 || fin <= ini) return []
  try {
    const lista = JSON.parse(texto.slice(ini, fin + 1)) as unknown
    if (!Array.isArray(lista)) return []
    return lista
      .map((o): Variante => {
        const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
        const titulo = limpio(r.titulo, 110)
        const acento = limpio(r.acento, 40)
        return {
          titulo,
          acento: titulo && acento && titulo.toLowerCase().includes(acento.toLowerCase()) ? acento : undefined,
          texto: limpio(r.texto, 240),
        }
      })
      .filter((v) => v.titulo || v.texto)
      .slice(0, 3)
  } catch {
    return []
  }
}
