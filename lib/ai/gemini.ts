// CLIENTE MÍNIMO DE GEMINI (REST, sin SDK): texto con herramientas y generación de imágenes («Nano Banana»).
//
// Se habla con la API por HTTP para no añadir dependencias y poder probarlo con un `fetch` inyectado. La clave viaja
// en la cabecera `x-goog-api-key` (nunca en la URL: acabaría en logs). Los modelos son configurables por subcuenta
// porque Google los renombra a menudo; aquí solo hay valores por defecto razonables.

export const GEMINI_MODELO_TEXTO = 'gemini-2.5-pro'
export const GEMINI_MODELO_IMAGEN = 'gemini-2.5-flash-image'
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

export type HerramientaGenerica = {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}
export type LlamadaHerramienta = { id?: string; name: string; args: Record<string, unknown> }
type Fetch = typeof fetch
export type GeminiParte = Record<string, unknown>
export type GeminiContenido = { role: 'user' | 'model'; parts: GeminiParte[] }

/** Los esquemas de herramientas del proyecto son JSON Schema en minúsculas; Gemini espera los tipos en mayúsculas. */
export function aEsquemaGemini(esquema: unknown): unknown {
  if (Array.isArray(esquema)) return esquema.map(aEsquemaGemini)
  if (esquema && typeof esquema === 'object') {
    const salida: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(esquema as Record<string, unknown>)) {
      if (k === 'additionalProperties') continue // no lo admite
      salida[k] = k === 'type' && typeof v === 'string' ? v.toUpperCase() : aEsquemaGemini(v)
    }
    return salida
  }
  return esquema
}

async function post(url: string, apiKey: string, cuerpo: unknown, f: Fetch, timeoutMs: number) {
  const res = await f(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const texto = await res.text()
  let json: Record<string, unknown> = {}
  try {
    json = texto ? (JSON.parse(texto) as Record<string, unknown>) : {}
  } catch {
    /* cuerpo no JSON: se informa abajo */
  }
  if (!res.ok) {
    const msg = (json.error as { message?: string } | undefined)?.message ?? texto.slice(0, 200)
    throw new Error(`Gemini respondió ${res.status}: ${msg}`)
  }
  return json
}

export type RespuestaGemini = {
  /** El contenido del modelo TAL CUAL: hay que devolverlo íntegro en el turno siguiente (conserva firmas de pensamiento). */
  contenido: GeminiContenido
  texto: string
  llamadas: LlamadaHerramienta[]
  finishReason: string | null
}

export async function geminiGenerar(p: {
  apiKey: string
  model?: string
  system?: string
  contents: GeminiContenido[]
  tools?: HerramientaGenerica[]
  maxTokens?: number
  temperature?: number
  json?: boolean
  fetchImpl?: Fetch
  timeoutMs?: number
}): Promise<RespuestaGemini> {
  const model = p.model || GEMINI_MODELO_TEXTO
  const cuerpo: Record<string, unknown> = {
    contents: p.contents,
    generationConfig: {
      maxOutputTokens: p.maxTokens ?? 8192,
      ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
      ...(p.json ? { responseMimeType: 'application/json' } : {}),
    },
  }
  if (p.system) cuerpo.systemInstruction = { parts: [{ text: p.system }] }
  if (p.tools?.length)
    cuerpo.tools = [
      {
        functionDeclarations: p.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: aEsquemaGemini(t.parameters),
        })),
      },
    ]
  const json = await post(
    `${BASE}/${encodeURIComponent(model)}:generateContent`,
    p.apiKey,
    cuerpo,
    p.fetchImpl ?? fetch,
    p.timeoutMs ?? 50_000
  )
  const cand = (json.candidates as { content?: GeminiContenido; finishReason?: string }[] | undefined)?.[0]
  const partes = cand?.content?.parts ?? []
  const llamadas: LlamadaHerramienta[] = []
  let texto = ''
  for (const parte of partes) {
    if (typeof parte.text === 'string' && parte.thought !== true) texto += parte.text
    const fc = parte.functionCall as { id?: string; name?: string; args?: Record<string, unknown> } | undefined
    if (fc?.name) llamadas.push({ id: fc.id, name: fc.name, args: fc.args ?? {} })
  }
  return {
    contenido: { role: 'model', parts: partes },
    texto,
    llamadas,
    finishReason: cand?.finishReason ?? null,
  }
}

/** Relaciones de aspecto que admite el modelo de imagen. */
const ASPECTOS_GEMINI = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']

export function aspectoGemini(aspecto: string): string {
  return ASPECTOS_GEMINI.includes(aspecto) ? aspecto : aspecto === 'A4' ? '3:4' : '1:1'
}

export async function geminiImagen(p: {
  apiKey: string
  model?: string
  prompt: string
  aspectRatio?: string
  /** Imágenes de referencia (marca, producto, persona) que el modelo debe respetar. */
  referencias?: { mime: string; base64: string }[]
  fetchImpl?: Fetch
  timeoutMs?: number
}): Promise<{ mime: string; datos: Buffer }> {
  const model = p.model || GEMINI_MODELO_IMAGEN
  const partes: GeminiParte[] = [{ text: p.prompt }]
  for (const r of p.referencias ?? []) partes.push({ inlineData: { mimeType: r.mime, data: r.base64 } })
  const json = await post(
    `${BASE}/${encodeURIComponent(model)}:generateContent`,
    p.apiKey,
    {
      contents: [{ parts: partes }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: aspectoGemini(p.aspectRatio ?? '1:1') },
      },
    },
    p.fetchImpl ?? fetch,
    p.timeoutMs ?? 55_000
  )
  const cand = (json.candidates as { content?: { parts?: GeminiParte[] }; finishReason?: string }[] | undefined)?.[0]
  for (const parte of cand?.content?.parts ?? []) {
    const d = (parte.inlineData ?? parte.inline_data) as
      { mimeType?: string; mime_type?: string; data?: string } | undefined
    if (d?.data) return { mime: d.mimeType ?? d.mime_type ?? 'image/png', datos: Buffer.from(d.data, 'base64') }
  }
  throw new Error(
    `Gemini no devolvió ninguna imagen${cand?.finishReason ? ` (motivo: ${cand.finishReason})` : ''}. Prueba a reformular el prompt.`
  )
}
