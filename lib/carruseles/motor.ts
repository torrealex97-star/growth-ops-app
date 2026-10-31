// MOTOR DE CARRUSELES MULTI-PROVEEDOR: qué IA escribe las slides y cuál dibuja las imágenes.
//
// Antes todo dependía de ANTHROPIC_API_KEY: sin ella no se creaba ningún carrusel. Ahora cualquiera de estas
// claves de la SUBCUENTA basta: Anthropic, Gemini (Google) u OpenAI para el texto y el diseño de las slides, y
// Gemini («Nano Banana») u OpenAI (gpt-image) para generar imágenes, flyers y fondos de historias.
//
// Este módulo es PURO (elección y bucle de herramientas con dependencias inyectadas) para poder probarlo sin red.

import {
  GEMINI_MODELO_IMAGEN,
  GEMINI_MODELO_TEXTO,
  geminiGenerar,
  type GeminiContenido,
  type HerramientaGenerica,
} from '@/lib/ai/gemini'
import { OPENAI_MODELO_IMAGEN, OPENAI_MODELO_TEXTO, openaiChat, type OpenAiMensaje } from '@/lib/ai/openai'

export type MotorTexto = 'anthropic' | 'gemini' | 'openai'
export type MotorImagen = 'gemini' | 'openai'
export type Cfg = Record<string, string | undefined>

const tiene = (v: string | undefined) => !!v && v.trim().length > 0

/**
 * Motor de texto: el que pida `CARRUSELES_IA_MOTOR` si tiene clave; si no, el primero con clave por este orden:
 * Anthropic (el modelo de siempre, con razonamiento largo de diseño), Gemini, OpenAI.
 */
export function elegirMotorTexto(cfg: Cfg): MotorTexto | null {
  const claves: Record<MotorTexto, boolean> = {
    anthropic: tiene(cfg.ANTHROPIC_API_KEY),
    gemini: tiene(cfg.GEMINI_API_KEY),
    openai: tiene(cfg.OPENAI_API_KEY),
  }
  const pedido = (cfg.CARRUSELES_IA_MOTOR ?? '').trim().toLowerCase() as MotorTexto
  if (pedido in claves && claves[pedido]) return pedido
  return (['anthropic', 'gemini', 'openai'] as MotorTexto[]).find((m) => claves[m]) ?? null
}

/** Motor de imágenes: el pedido si tiene clave; si no, Gemini (Nano Banana) y luego OpenAI. */
export function elegirMotorImagen(cfg: Cfg): MotorImagen | null {
  const claves: Record<MotorImagen, boolean> = { gemini: tiene(cfg.GEMINI_API_KEY), openai: tiene(cfg.OPENAI_API_KEY) }
  const pedido = (cfg.CARRUSELES_IMAGEN_MOTOR ?? '').trim().toLowerCase() as MotorImagen
  if (pedido in claves && claves[pedido]) return pedido
  return (['gemini', 'openai'] as MotorImagen[]).find((m) => claves[m]) ?? null
}

export function modeloTexto(cfg: Cfg, motor: Exclude<MotorTexto, 'anthropic'>): string {
  return (
    (motor === 'gemini' ? cfg.GEMINI_MODELO_TEXTO : cfg.OPENAI_MODELO_TEXTO)?.trim() ||
    (motor === 'gemini' ? GEMINI_MODELO_TEXTO : OPENAI_MODELO_TEXTO)
  )
}
export function modeloImagen(cfg: Cfg, motor: MotorImagen): string {
  return (
    (motor === 'gemini' ? cfg.GEMINI_MODELO_IMAGEN : cfg.OPENAI_MODELO_IMAGEN)?.trim() ||
    (motor === 'gemini' ? GEMINI_MODELO_IMAGEN : OPENAI_MODELO_IMAGEN)
  )
}

export const MENSAJE_SIN_MOTOR =
  'Falta una clave de IA: añade la de Anthropic, la de Gemini (Google AI Studio) o la de OpenAI en Integraciones → Inteligencia artificial.'

/** Imagen de referencia ya descargada, neutra respecto al proveedor. */
export type ImagenReferencia = { mime: string; base64: string }

export type OpcionesBucle = {
  motor: Exclude<MotorTexto, 'anthropic'>
  cfg: Cfg
  system: string
  /** Turnos anteriores (solo texto). */
  historial: { role: 'user' | 'assistant'; content: string }[]
  textoUsuario: string
  imagenes: ImagenReferencia[]
  tools: HerramientaGenerica[]
  ejecutar: (nombre: string, args: Record<string, unknown>) => Promise<string>
  /** Si devuelve texto, se le dice al modelo que continúe (faltan slides). */
  continuar?: () => Promise<string | null>
  onTexto: (t: string) => void
  onCambio: () => void
  maxIteraciones?: number
  maxContinuaciones?: number
  /** Tiempo total que se permite al bucle (la función de Vercel tiene tope). */
  presupuestoMs?: number
  ahora?: () => number
  /** Inyectables para pruebas. */
  gemini?: typeof geminiGenerar
  openai?: typeof openaiChat
}

/**
 * Bucle de herramientas para Gemini y OpenAI: el modelo llama a `add_slide`, etc., hasta terminar. Equivale al bucle de
 * Anthropic de la ruta, con dos diferencias deliberadas: no hace streaming (se envía el texto al terminar cada vuelta) y
 * se acota por TIEMPO, porque cada llamada puede tardar decenas de segundos y la función tiene un tope.
 */
export async function ejecutarBucleGenerico(o: OpcionesBucle): Promise<{ truncado: boolean }> {
  const ahora = o.ahora ?? Date.now
  const limite = ahora() + (o.presupuestoMs ?? 48_000)
  const maxIter = o.maxIteraciones ?? 16
  const maxCont = o.maxContinuaciones ?? 3
  let continuaciones = 0

  const gemini = o.gemini ?? geminiGenerar
  const openai = o.openai ?? openaiChat
  const modelo = modeloTexto(o.cfg, o.motor)
  const apiKey = (o.motor === 'gemini' ? o.cfg.GEMINI_API_KEY : o.cfg.OPENAI_API_KEY) ?? ''

  // Estado de la conversación en el formato de cada proveedor.
  const contentsGemini: GeminiContenido[] = []
  const mensajesOpenAi: OpenAiMensaje[] = []
  if (o.motor === 'gemini') {
    for (const h of o.historial)
      contentsGemini.push({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.content }] })
    contentsGemini.push({
      role: 'user',
      parts: [
        { text: o.textoUsuario },
        ...o.imagenes.map((i) => ({ inlineData: { mimeType: i.mime, data: i.base64 } })),
      ],
    })
  } else {
    mensajesOpenAi.push({ role: 'system', content: o.system })
    for (const h of o.historial) mensajesOpenAi.push({ role: h.role, content: h.content })
    mensajesOpenAi.push({
      role: 'user',
      content: [
        { type: 'text', text: o.textoUsuario },
        ...o.imagenes.map((i) => ({ type: 'image_url', image_url: { url: `data:${i.mime};base64,${i.base64}` } })),
      ],
    })
  }

  for (let iter = 0; iter < maxIter; iter++) {
    if (ahora() > limite) return { truncado: true }
    let texto = ''
    let llamadas: { id?: string; name: string; args: Record<string, unknown> }[] = []
    if (o.motor === 'gemini') {
      const r = await gemini({
        apiKey,
        model: modelo,
        system: o.system,
        contents: contentsGemini,
        tools: o.tools,
        maxTokens: 16000,
        timeoutMs: Math.max(5_000, limite - ahora()),
      })
      contentsGemini.push(r.contenido)
      texto = r.texto
      llamadas = r.llamadas
    } else {
      const r = await openai({
        apiKey,
        model: modelo,
        messages: mensajesOpenAi,
        tools: o.tools,
        maxTokens: 16000,
        timeoutMs: Math.max(5_000, limite - ahora()),
      })
      mensajesOpenAi.push(r.mensaje)
      texto = r.texto
      llamadas = r.llamadas
    }
    if (texto.trim()) o.onTexto(texto)

    if (llamadas.length === 0) {
      const empujon = o.continuar && continuaciones < maxCont ? await o.continuar() : null
      if (empujon) {
        continuaciones++
        if (o.motor === 'gemini') contentsGemini.push({ role: 'user', parts: [{ text: empujon }] })
        else mensajesOpenAi.push({ role: 'user', content: empujon })
        continue
      }
      return { truncado: false }
    }

    // Exactamente una respuesta por llamada (Gemini deja respuestas vacías si no coinciden).
    const respuestasGemini: Record<string, unknown>[] = []
    for (const l of llamadas) {
      const salida = await o.ejecutar(l.name, l.args)
      o.onCambio()
      if (o.motor === 'gemini')
        respuestasGemini.push({
          functionResponse: { name: l.name, ...(l.id ? { id: l.id } : {}), response: { result: salida } },
        })
      else mensajesOpenAi.push({ role: 'tool', tool_call_id: l.id, content: salida })
    }
    if (o.motor === 'gemini') contentsGemini.push({ role: 'user', parts: respuestasGemini })
  }
  return { truncado: true }
}
