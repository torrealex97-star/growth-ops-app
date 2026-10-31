// IMÁGENES GENERADAS POR IA para carruseles, flyers e historias (Gemini «Nano Banana» u OpenAI gpt-image).
//
// El modelo de diseño las pide con la herramienta `generate_image` y las usa en el HTML de la slide como fondo o
// ilustración. Aquí se decide el proveedor, se refuerza el prompt para que el resultado sirva de lienzo (sin texto
// pintado, con espacio para el titular) y se guarda la imagen en Storage: la slide referencia una URL pública estable,
// no un base64 gigante dentro del HTML.

import { createClient } from '@supabase/supabase-js'
import { geminiImagen } from '@/lib/ai/gemini'
import { openaiImagen } from '@/lib/ai/openai'
import { elegirMotorImagen, modeloImagen, type Cfg, type ImagenReferencia } from './motor'
import type { AspectRatio } from './types'

export const BUCKET_IMAGENES = 'carrusel-uploads'
export const MAX_IMAGENES_POR_PETICION = 4
const MAX_PROMPT = 1500

/** Aspecto que se pide al modelo de imagen según el formato del proyecto. */
export function aspectoParaImagen(formato: AspectRatio): string {
  return formato === 'A4' ? '3:4' : formato
}

/**
 * Refuerza el prompt del modelo de diseño. Los modelos de imagen pintan texto deformado: se les pide NO incluirlo (el
 * texto lo pone el HTML, nítido y editable) y se reserva espacio para el titular, que es lo que separa una imagen
 * bonita de una pieza utilizable.
 */
export function reforzarPrompt(prompt: string, o: { formato: AspectRatio; marca?: string; estilo?: string[] }): string {
  const limpio = prompt.replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT)
  return [
    limpio,
    `Formato ${o.formato} (${o.formato === '9:16' ? 'historia vertical a pantalla completa' : o.formato === 'A4' ? 'flyer impreso' : 'publicación de Instagram'}).`,
    'Calidad de estudio, composición profesional, iluminación cuidada, alta resolución, colores coherentes con la marca.',
    'NO incluyas texto, letras, números, logotipos ni marcas de agua dentro de la imagen: el texto se añade después.',
    'Deja una zona despejada (tercio superior o inferior) con menos detalle para poder superponer un titular legible.',
    o.estilo?.length ? `Estilo: ${o.estilo.slice(0, 6).join(', ')}.` : '',
    o.marca ? `Marca: ${o.marca}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export type ResultadoImagen = { url: string; motor: 'gemini' | 'openai' }

export async function generarImagenIA(p: {
  cfg: Cfg
  tenantSlug: string
  prompt: string
  formato: AspectRatio
  marca?: string
  estilo?: string[]
  referencias?: ImagenReferencia[]
  /** Inyectables para pruebas. */
  gemini?: typeof geminiImagen
  openai?: typeof openaiImagen
  subir?: (ruta: string, datos: Buffer, mime: string) => Promise<string>
}): Promise<ResultadoImagen> {
  const motor = elegirMotorImagen(p.cfg)
  if (!motor) throw new Error('No hay clave para generar imágenes: añade la de Gemini u OpenAI en Integraciones.')
  const prompt = reforzarPrompt(p.prompt, { formato: p.formato, marca: p.marca, estilo: p.estilo })
  const aspecto = aspectoParaImagen(p.formato)
  const modelo = modeloImagen(p.cfg, motor)
  const img =
    motor === 'gemini'
      ? await (p.gemini ?? geminiImagen)({
          apiKey: p.cfg.GEMINI_API_KEY!,
          model: modelo,
          prompt,
          aspectRatio: aspecto,
          referencias: p.referencias,
        })
      : await (p.openai ?? openaiImagen)({ apiKey: p.cfg.OPENAI_API_KEY!, model: modelo, prompt, aspectRatio: aspecto })

  const ext = img.mime.includes('jpeg') ? 'jpg' : img.mime.includes('webp') ? 'webp' : 'png'
  const ruta = `${p.tenantSlug}/ia/${crypto.randomUUID()}.${ext}`
  const subir = p.subir ?? subirAStorage
  return { url: await subir(ruta, img.datos, img.mime), motor }
}

async function subirAStorage(ruta: string, datos: Buffer, mime: string): Promise<string> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
  const { error } = await sb.storage.from(BUCKET_IMAGENES).upload(ruta, datos, { contentType: mime, upsert: false })
  if (error) throw new Error(`No se pudo guardar la imagen generada: ${error.message}`)
  return sb.storage.from(BUCKET_IMAGENES).getPublicUrl(ruta).data.publicUrl
}
