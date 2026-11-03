import Anthropic from '@anthropic-ai/sdk'
import { geminiGenerar } from '@/lib/ai/gemini'
import { openaiChat, urlBaseOpenAi } from '@/lib/ai/openai'
import { esUrlPublicaSegura } from '@/lib/security/safe-url'
import { elegirMotorTexto, modeloTexto, type Cfg } from './motor'

// EJEMPLOS DEL TENANT: capturas de historias y carruseles que ya hizo. La app los analiza con visión y guarda una
// GUÍA DE ESTILO (texto) que se inyecta en cada generación para ser fiel a su diseño. Se guardan en
// `tenants.settings.carruseles_ejemplos` (sin migración).

export type TipoEjemplo = 'historias' | 'carrusel'
export type Ejemplo = { id: string; url: string; name: string; tipo: TipoEjemplo; addedAt: string }
export type EjemplosTenant = { ejemplos: Ejemplo[]; guia: Record<TipoEjemplo, string> }

export const MAX_EJEMPLOS_POR_TIPO = 10
export const MAX_GUIA = 4000
/** Cuántos ejemplos se analizan y se adjuntan a la generación (coste y tamaño). */
export const MAX_EJEMPLOS_ANALISIS = 6
export const MAX_EJEMPLOS_ADJUNTOS = 3
const MODELO_ANTHROPIC = 'claude-sonnet-5'

export const esTipoEjemplo = (v: unknown): v is TipoEjemplo => v === 'historias' || v === 'carrusel'

/** Lee lo guardado en `settings` con cualquier forma y devuelve algo seguro de usar. */
export function leerEjemplosDeSettings(settings: unknown): EjemplosTenant {
  const bruto = (settings as { carruseles_ejemplos?: Record<string, unknown> } | null)?.carruseles_ejemplos
  const lista = Array.isArray(bruto?.ejemplos) ? (bruto.ejemplos as Record<string, unknown>[]) : []
  const ejemplos = lista
    .filter((e) => typeof e?.id === 'string' && typeof e?.url === 'string' && esTipoEjemplo(e?.tipo))
    .map((e) => ({
      id: e.id as string,
      url: e.url as string,
      name: typeof e.name === 'string' ? e.name : 'ejemplo',
      tipo: e.tipo as TipoEjemplo,
      addedAt: typeof e.addedAt === 'string' ? e.addedAt : '',
    }))
  const g = (bruto?.guia ?? {}) as Record<string, unknown>
  return {
    ejemplos,
    guia: {
      historias: typeof g.historias === 'string' ? g.historias : '',
      carrusel: typeof g.carrusel === 'string' ? g.carrusel : '',
    },
  }
}

export function conEjemplo(estado: EjemplosTenant, nuevo: Ejemplo): EjemplosTenant {
  if (estado.ejemplos.filter((e) => e.tipo === nuevo.tipo).length >= MAX_EJEMPLOS_POR_TIPO)
    throw new Error(`Máximo ${MAX_EJEMPLOS_POR_TIPO} ejemplos por tipo: quita alguno antes de añadir otro`)
  return { ...estado, ejemplos: [...estado.ejemplos, nuevo] }
}

export const sinEjemplo = (estado: EjemplosTenant, id: string): EjemplosTenant => ({
  ...estado,
  ejemplos: estado.ejemplos.filter((e) => e.id !== id),
})

export function conGuia(estado: EjemplosTenant, tipo: TipoEjemplo, texto: string): EjemplosTenant {
  return { ...estado, guia: { ...estado.guia, [tipo]: texto.trim().slice(0, MAX_GUIA) } }
}

export const PROMPT_ANALISIS = (tipo: TipoEjemplo, n: number) =>
  `Eres director de arte. Te paso ${n} capturas de ${
    tipo === 'historias' ? 'HISTORIAS de Instagram' : 'CARRUSELES de Instagram'
  } del mismo creador. Escribe en español una GUÍA DE ESTILO accionable (máximo 350 palabras) para que otra IA genere piezas nuevas idénticas en estilo. Describe SOLO lo que se ve, sin inventar:
- Tipografías (familia aproximada, peso, mayúsculas/minúsculas) y tamaños relativos.
- Cómo se coloca el texto (zona, alineación, ancho), cajas o marcadores detrás del texto y de qué color.
- Colores y tipo de fondo (foto, foto oscurecida, color liso, diseñado) y cuándo se usa cada uno.
- Elementos recurrentes (stickers, flechas, emojis, etiquetas, logo, capturas) y dónde van.
- Estructura de la secuencia: qué función cumple cada pieza (gancho, problema, prueba, cierre...).
- Tono del copy (longitud de frases, tuteo, palabras de acento).
Responde solo con la guía, en viñetas.`

type ImagenB64 = { mime: string; base64: string }

const MIMES = ['image/png', 'image/jpeg', 'image/webp']

/** Descarga un ejemplo (solo https público, ≤4 MB). Devuelve null si no se puede, para saltarlo. */
export async function descargarEjemplo(url: string, f: typeof fetch = fetch): Promise<ImagenB64 | null> {
  if (!esUrlPublicaSegura(url)) return null
  try {
    const res = await f(url, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return null
    const mime = MIMES.find((m) => (res.headers.get('content-type') ?? '').includes(m))
    if (!mime) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 4 * 1024 * 1024 ? null : { mime, base64: buf.toString('base64') }
  } catch {
    return null
  }
}

/** Analiza los ejemplos con el motor de IA que tenga clave y devuelve la guía de estilo. */
export async function analizarEjemplos(
  cfg: Cfg,
  tipo: TipoEjemplo,
  imagenes: ImagenB64[],
  inyectado: {
    anthropic?: (p: { texto: string; imagenes: ImagenB64[] }) => Promise<string>
    gemini?: typeof geminiGenerar
    openai?: typeof openaiChat
  } = {}
): Promise<string> {
  if (!imagenes.length) throw new Error('No hay ejemplos que analizar')
  const motor = elegirMotorTexto(cfg)
  if (!motor) throw new Error('Falta una clave de IA en Integraciones')
  const texto = PROMPT_ANALISIS(tipo, imagenes.length)
  let salida = ''
  if (motor === 'anthropic') {
    salida = await (inyectado.anthropic ?? analizarConAnthropic(cfg))({ texto, imagenes })
  } else if (motor === 'gemini') {
    const r = await (inyectado.gemini ?? geminiGenerar)({
      apiKey: cfg.GEMINI_API_KEY as string,
      model: modeloTexto(cfg, 'gemini'),
      contents: [
        {
          role: 'user',
          parts: [{ text: texto }, ...imagenes.map((i) => ({ inlineData: { mimeType: i.mime, data: i.base64 } }))],
        },
      ],
      maxTokens: 1500,
    })
    salida = r.texto
  } else {
    const r = await (inyectado.openai ?? openaiChat)({
      apiKey: cfg.OPENAI_API_KEY as string,
      baseUrl: urlBaseOpenAi(cfg),
      model: modeloTexto(cfg, 'openai'),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: texto },
            ...imagenes.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.base64}` } })),
          ],
        },
      ],
      maxTokens: 1500,
    })
    salida = r.texto
  }
  const guia = salida.trim().slice(0, MAX_GUIA)
  if (!guia) throw new Error('La IA no devolvió ninguna guía. Inténtalo de nuevo.')
  return guia
}

const analizarConAnthropic = (cfg: Cfg) => async (p: { texto: string; imagenes: ImagenB64[] }) => {
  const client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY ?? '' })
  const r = await client.messages.create({
    model: MODELO_ANTHROPIC,
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content: [
          ...p.imagenes.map((i) => ({
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              media_type: i.mime as 'image/png' | 'image/jpeg' | 'image/webp',
              data: i.base64,
            },
          })),
          { type: 'text' as const, text: p.texto },
        ],
      },
    ],
  })
  return r.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
}

/** Sección del prompt con la guía de estilo del tenant (vacía si no hay). */
export function seccionGuiaPrompt(tipo: TipoEjemplo, guia: string | null | undefined, adjuntas: number): string {
  if (!guia?.trim()) return ''
  return `\n\n## Estilo del tenant (sacado de sus propios ejemplos de ${tipo === 'historias' ? 'historias' : 'carruseles'})
${guia.trim()}
${adjuntas > 0 ? `Se adjuntan ${adjuntas} ejemplos reales: míralos y reproduce su estilo, no el genérico.` : ''}
${tipo === 'historias' ? 'Traduce la guía a las opciones de add_story (plantilla, fuente, fondoTexto, colorTexto, estilo de foto) y al texto.' : 'Replica esa estructura y diseño en cada slide.'}`
}
