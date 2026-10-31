// Generación de IMÁGENES (carruseles, flyers, historias): proveedores intercambiables.
//
// POR QUÉ EXISTE. El módulo de carruseles solo sabía trabajar con Anthropic: sin esa clave devolvía un
// 503 y la pantalla se quedaba muerta aunque la subcuenta tuviera otra IA conectada. Aquí la imagen se
// genera con el proveedor que la subcuenta tenga —Gemini (Nano Banana) u OpenAI (gpt-image-1)— y
// ninguno es obligatorio: con uno basta, con ninguno se dice qué conectar.
//
// LA REGLA (relevo con rastro). Se usa el proveedor preferido; si falla, el otro conectado toma el
// relevo y se deja escrito por qué (`fallbackReason`): un cambio silencioso de motor es una avería
// invisible. Las claves salen de la instantánea de la subcuenta (`getTenantConfigWithFallback`), nunca
// de `process.env` global, para que la clave de un cliente no atienda la petición de otro.
import type { AspectRatio } from '@/lib/carruseles/types'

export type ImageProvider = 'gemini' | 'openai'
export type ImageEnv = Record<string, string | undefined>
export type ImageFormat = AspectRatio

export const IMAGE_PROVIDERS: ImageProvider[] = ['gemini', 'openai']
export const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image'
export const OPENAI_IMAGE_MODEL = 'gpt-image-1'

export type ImageRequest = {
  prompt: string
  formato: ImageFormat
  /** Proveedor preferido. Si no está conectado o falla, toma el relevo el otro. */
  preferido?: ImageProvider
}

export type ImageResult = {
  base64: string
  mime: string
  proveedor: ImageProvider
  modelo: string
  /** Por qué no se usó el preferido, si no se usó. */
  fallbackReason?: string
}

export class ImageError extends Error {
  detalle: string[]
  constructor(message: string, detalle: string[] = []) {
    super(message)
    this.name = 'ImageError'
    this.detalle = detalle
  }
}

const keyOf = (proveedor: ImageProvider, env: ImageEnv): string | undefined => {
  const k = proveedor === 'gemini' ? env.GEMINI_API_KEY : env.OPENAI_API_KEY
  return k?.trim() ? k.trim() : undefined
}

/** Proveedores conectados, el preferido primero. */
export function proveedoresDisponibles(env: ImageEnv, preferido?: ImageProvider): ImageProvider[] {
  const orden = preferido ? [preferido, ...IMAGE_PROVIDERS.filter((p) => p !== preferido)] : IMAGE_PROVIDERS
  return orden.filter((p) => keyOf(p, env))
}

const GEMINI_RATIO: Record<ImageFormat, string> = {
  '1:1': '1:1',
  '4:5': '4:5',
  '9:16': '9:16',
  '3:4': '3:4',
  A4: '3:4',
}
// gpt-image-1 solo admite tres tamaños: el vertical sirve a 4:5, 3:4, 9:16 y A4 (se recorta/ajusta al tamaño final de la pieza).
const OPENAI_SIZE: Record<ImageFormat, string> = {
  '1:1': '1024x1024',
  '4:5': '1024x1536',
  '3:4': '1024x1536',
  '9:16': '1024x1536',
  A4: '1024x1536',
}

type FetchImpl = typeof fetch

async function conTiempo(fetchImpl: FetchImpl, url: string, init: RequestInit): Promise<Response> {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(55_000) })
}

async function mensajeDeError(respuesta: Response): Promise<string> {
  const cuerpo = (await respuesta.json().catch(() => null)) as { error?: { message?: string } | string } | null
  const texto = typeof cuerpo?.error === 'string' ? cuerpo.error : cuerpo?.error?.message
  return `HTTP ${respuesta.status}${texto ? `: ${String(texto).slice(0, 200)}` : ''}`
}

async function conGemini(req: ImageRequest, apiKey: string, env: ImageEnv, fetchImpl: FetchImpl): Promise<ImageResult> {
  const modelo = env.GEMINI_IMAGE_MODEL?.trim() || GEMINI_IMAGE_MODEL
  const respuesta = await conTiempo(
    fetchImpl,
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: req.prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: GEMINI_RATIO[req.formato] } },
      }),
    }
  )
  if (!respuesta.ok) throw new Error(await mensajeDeError(respuesta))
  const datos = (await respuesta.json().catch(() => null)) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { mimeType?: string; data?: string }
          inline_data?: { mime_type?: string; data?: string }
        }>
      }
    }>
  } | null
  for (const parte of datos?.candidates?.[0]?.content?.parts ?? []) {
    const data = parte.inlineData?.data ?? parte.inline_data?.data
    if (data)
      return {
        base64: data,
        mime: parte.inlineData?.mimeType ?? parte.inline_data?.mime_type ?? 'image/png',
        proveedor: 'gemini',
        modelo,
      }
  }
  throw new Error('la respuesta no trae ninguna imagen (puede haberla bloqueado el filtro de seguridad)')
}

async function conOpenAi(req: ImageRequest, apiKey: string, env: ImageEnv, fetchImpl: FetchImpl): Promise<ImageResult> {
  const modelo = env.OPENAI_IMAGE_MODEL?.trim() || OPENAI_IMAGE_MODEL
  const respuesta = await conTiempo(fetchImpl, 'https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: modelo, prompt: req.prompt, size: OPENAI_SIZE[req.formato], n: 1, quality: 'high' }),
  })
  if (!respuesta.ok) throw new Error(await mensajeDeError(respuesta))
  const datos = (await respuesta.json().catch(() => null)) as { data?: Array<{ b64_json?: string }> } | null
  const b64 = datos?.data?.[0]?.b64_json
  if (!b64) throw new Error('la respuesta no trae ninguna imagen')
  return { base64: b64, mime: 'image/png', proveedor: 'openai', modelo }
}

const NOMBRE: Record<ImageProvider, string> = { gemini: 'Gemini', openai: 'OpenAI' }

/** Genera una imagen con el proveedor preferido y, si falla, con el otro conectado. Nunca inventa una imagen. */
export async function generarImagen(
  req: ImageRequest,
  env: ImageEnv,
  fetchImpl: FetchImpl = fetch
): Promise<ImageResult> {
  const prompt = req.prompt.trim()
  if (!prompt) throw new ImageError('Falta la descripción de la imagen.')
  const disponibles = proveedoresDisponibles(env, req.preferido)
  if (!disponibles.length) {
    throw new ImageError(
      'No hay ningún proveedor de imágenes conectado. Conecta una clave de Gemini u OpenAI en Ajustes → Integraciones → Inteligencia artificial.'
    )
  }
  const fallos: string[] = []
  for (const proveedor of disponibles) {
    const apiKey = keyOf(proveedor, env)!
    try {
      const resultado = await (proveedor === 'gemini' ? conGemini : conOpenAi)(
        { ...req, prompt },
        apiKey,
        env,
        fetchImpl
      )
      const preferidoFallo = req.preferido && proveedor !== req.preferido
      const motivo = fallos.length
        ? `${fallos.join(' · ')}; atendió ${NOMBRE[proveedor]}`
        : preferidoFallo
          ? `${NOMBRE[req.preferido!]} no está conectado; atendió ${NOMBRE[proveedor]}`
          : undefined
      return motivo ? { ...resultado, fallbackReason: motivo } : resultado
    } catch (error) {
      fallos.push(`${NOMBRE[proveedor]}: ${(error as Error).message}`)
    }
  }
  throw new ImageError(`No se pudo generar la imagen. ${fallos.join(' · ')}`, fallos)
}

export type TipoPieza = 'carrusel' | 'flyer' | 'historia'

const DIRECCION: Record<TipoPieza, string> = {
  carrusel:
    'Diapositiva de un carrusel de Instagram: composición limpia, un solo mensaje, jerarquía tipográfica clara y espacio para respirar.',
  flyer:
    'Flyer promocional: titular grande, una llamada a la acción visible, información ordenada y contraste alto para leerse a primera vista.',
  historia:
    'Historia vertical de Instagram: el contenido importante queda en la zona central (sin tapar la parte superior ni la inferior con elementos clave), formato de móvil.',
}

export type MarcaVisual = { nombre?: string; colores?: string[]; estilo?: string }

/**
 * Prompt visual con criterio de diseño. Lo que se pide a la IA de imagen es lo que decide si el
 * resultado sirve: texto breve y exacto (los modelos fallan con párrafos), marca explícita y prohibiciones
 * claras (sin logos de terceros, sin marcas de agua, sin texto inventado).
 */
export function construirPromptVisual(entrada: {
  tipo: TipoPieza
  idea: string
  textoEnImagen?: string
  marca?: MarcaVisual
}): string {
  const lineas = [DIRECCION[entrada.tipo], `Idea: ${entrada.idea.trim()}`]
  const texto = entrada.textoEnImagen?.trim()
  if (texto)
    lineas.push(`Texto que debe aparecer, escrito EXACTAMENTE así y sin añadir nada más: «${texto.slice(0, 120)}»`)
  const marca = entrada.marca
  if (marca?.nombre) lineas.push(`Marca: ${marca.nombre}.`)
  if (marca?.colores?.length) lineas.push(`Paleta de marca: ${marca.colores.slice(0, 5).join(', ')}.`)
  if (marca?.estilo) lineas.push(`Estilo: ${marca.estilo}.`)
  lineas.push(
    'Calidad de estudio, iluminación cuidada, tipografía legible y sin faltas. Sin marcas de agua, sin logos de terceros y sin texto inventado.'
  )
  return lineas.join('\n')
}
