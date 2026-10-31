// CLIENTE MÍNIMO DE OPENAI (REST, sin SDK): chat con herramientas e imágenes (gpt-image). Mismo criterio que gemini.ts:
// `fetch` inyectable, clave en cabecera, modelos configurables por subcuenta.

import type { HerramientaGenerica, LlamadaHerramienta } from './gemini'

export const OPENAI_MODELO_TEXTO = 'gpt-4.1'
export const OPENAI_MODELO_IMAGEN = 'gpt-image-1'
const BASE = 'https://api.openai.com/v1'
type Fetch = typeof fetch

export type OpenAiMensaje = Record<string, unknown>

async function post(ruta: string, apiKey: string, cuerpo: unknown, f: Fetch, timeoutMs: number) {
  const res = await f(`${BASE}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const texto = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = texto ? (JSON.parse(texto) as Record<string, unknown>) : {}
  } catch {
    /* cuerpo no JSON */
  }
  if (!res.ok) {
    const msg = (json.error as { message?: string } | undefined)?.message ?? texto.slice(0, 200)
    throw new Error(`OpenAI respondió ${res.status}: ${msg}`)
  }
  return json
}

export async function openaiChat(p: {
  apiKey: string
  model?: string
  messages: OpenAiMensaje[]
  tools?: HerramientaGenerica[]
  maxTokens?: number
  json?: boolean
  fetchImpl?: Fetch
  timeoutMs?: number
}): Promise<{ mensaje: OpenAiMensaje; texto: string; llamadas: LlamadaHerramienta[] }> {
  const cuerpo: Record<string, unknown> = {
    model: p.model || OPENAI_MODELO_TEXTO,
    messages: p.messages,
    // `max_completion_tokens` lo aceptan tanto los modelos clásicos como los de razonamiento.
    max_completion_tokens: p.maxTokens ?? 8192,
  }
  if (p.json) cuerpo.response_format = { type: 'json_object' }
  if (p.tools?.length)
    cuerpo.tools = p.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))
  const json = await post('/chat/completions', p.apiKey, cuerpo, p.fetchImpl ?? fetch, p.timeoutMs ?? 50_000)
  const mensaje = ((json.choices as { message?: OpenAiMensaje }[] | undefined)?.[0]?.message ?? {}) as OpenAiMensaje
  const llamadas: LlamadaHerramienta[] = []
  for (const tc of (mensaje.tool_calls as
    { id?: string; function?: { name?: string; arguments?: string } }[] | undefined) ?? []) {
    if (!tc.function?.name) continue
    let args: Record<string, unknown> = {}
    try {
      args = tc.function.arguments ? (JSON.parse(tc.function.arguments) as Record<string, unknown>) : {}
    } catch {
      /* argumentos mal formados: la herramienta recibirá un objeto vacío y devolverá su error al modelo */
    }
    llamadas.push({ id: tc.id, name: tc.function.name, args })
  }
  return { mensaje, texto: typeof mensaje.content === 'string' ? mensaje.content : '', llamadas }
}

/** Tamaño admitido por gpt-image según la forma: vertical, horizontal o cuadrada. */
export function tamanoOpenAi(aspecto: string): '1024x1024' | '1024x1536' | '1536x1024' {
  if (aspecto === '16:9' || aspecto === '3:2' || aspecto === '4:3' || aspecto === '5:4') return '1536x1024'
  if (aspecto === '1:1') return '1024x1024'
  return '1024x1536' // 4:5, 9:16, 3:4, 2:3, A4…
}

export async function openaiImagen(p: {
  apiKey: string
  model?: string
  prompt: string
  aspectRatio?: string
  fetchImpl?: Fetch
  timeoutMs?: number
}): Promise<{ mime: string; datos: Buffer }> {
  const json = await post(
    '/images/generations',
    p.apiKey,
    {
      model: p.model || OPENAI_MODELO_IMAGEN,
      prompt: p.prompt,
      size: tamanoOpenAi(p.aspectRatio ?? '1:1'),
      quality: 'high',
      n: 1,
    },
    p.fetchImpl ?? fetch,
    p.timeoutMs ?? 55_000
  )
  const b64 = (json.data as { b64_json?: string }[] | undefined)?.[0]?.b64_json
  if (!b64) throw new Error('OpenAI no devolvió ninguna imagen. Prueba a reformular el prompt.')
  return { mime: 'image/png', datos: Buffer.from(b64, 'base64') }
}
