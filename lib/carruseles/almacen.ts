import type { SupabaseClient } from '@supabase/supabase-js'

// Almacén de los carruseles: fotos, vídeos, logos e imágenes generadas viven en UN bucket público.
// En producción el bucket no existía (nadie lo creó con una migración), así que toda subida fallaba con
// «Bucket not found». Se crea al vuelo la primera vez, como ya hacen otras rutas de la app.

export const BUCKET_CARRUSELES = 'carrusel-uploads'
export const MIME_IMAGEN = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
export const MIME_VIDEO = ['video/mp4', 'video/webm', 'video/quicktime']
export const MAX_IMAGEN = 15 * 1024 * 1024
/** Tope del plan gratuito de Supabase Storage por archivo. */
export const MAX_VIDEO = 50 * 1024 * 1024

const EXT_VIDEO = /\.(mp4|webm|mov|m4v)(\?|#|$)/i

export const esVideoUrl = (url: string): boolean => EXT_VIDEO.test(url)
export const tipoDeMedio = (url: string): 'image' | 'video' => (esVideoUrl(url) ? 'video' : 'image')

/** Sube al bucket y, si aún no existe, lo crea (público, con tope de tamaño y tipos permitidos) y reintenta una vez. */
export async function subirAlBucket(
  sb: SupabaseClient,
  ruta: string,
  datos: Buffer,
  contentType: string
): Promise<{ error: string | null; url: string }> {
  const subir = () => sb.storage.from(BUCKET_CARRUSELES).upload(ruta, datos, { contentType, upsert: false })
  let r = await subir()
  if (r.error && /bucket.*not.*found|not found/i.test(r.error.message)) {
    const fallo = await asegurarBucket(sb)
    if (fallo) return { error: fallo, url: '' }
    r = await subir()
  }
  if (r.error) return { error: r.error.message, url: '' }
  return { error: null, url: sb.storage.from(BUCKET_CARRUSELES).getPublicUrl(ruta).data.publicUrl }
}

// ── Subida directa del navegador al almacén. Vercel rechaza cuerpos de más de ~4,5 MB, así que los archivos NO pasan por
// nuestras rutas: el servidor valida y entrega una dirección de subida de un solo uso, y el navegador sube a ella.

export const CARPETAS_SUBIDA = ['referencias', 'ejemplos', 'marca', 'caso-exito'] as const
export type CarpetaSubida = (typeof CARPETAS_SUBIDA)[number]

export const EXT_POR_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

/** Mensaje de error si el archivo no se puede subir a esa carpeta; null si vale. El SVG solo en «marca» (logos). */
export function validarArchivo(mime: string, size: number, carpeta: CarpetaSubida): string | null {
  const esVideo = MIME_VIDEO.includes(mime)
  const permitido = [
    ...MIME_IMAGEN.filter((m) => m !== 'image/svg+xml' || carpeta === 'marca'),
    ...(carpeta === 'referencias' ? MIME_VIDEO : []),
  ]
  if (!permitido.includes(mime))
    return carpeta === 'referencias'
      ? 'Formato no soportado (imágenes PNG/JPG/WEBP o vídeos MP4/WEBM/MOV)'
      : 'Formato no soportado (imagen PNG, JPG o WEBP)'
  if (!Number.isFinite(size) || size <= 0) return 'El archivo está vacío'
  if (size > (esVideo ? MAX_VIDEO : MAX_IMAGEN))
    return esVideo ? 'El vídeo pesa más de 50 MB' : 'La imagen pesa más de 15 MB'
  return null
}

/** Crea el almacén si no existe (público, con tope de tamaño y tipos permitidos). Devuelve un mensaje de error o null. */
export async function asegurarBucket(sb: SupabaseClient): Promise<string | null> {
  const { error } = await sb.storage.createBucket(BUCKET_CARRUSELES, {
    public: true,
    fileSizeLimit: MAX_VIDEO,
    allowedMimeTypes: [...MIME_IMAGEN, ...MIME_VIDEO],
  })
  return error && !/already exists|duplicate/i.test(error.message)
    ? `No se pudo crear el almacén de archivos: ${error.message}`
    : null
}

/** Una ruta del almacén que el servidor entregó para esa carpeta y subcuenta (lo que llega al registrar un archivo ya subido). */
export const rutaValida = (ruta: unknown, tenant: string, carpeta: CarpetaSubida): ruta is string =>
  typeof ruta === 'string' &&
  ruta.startsWith(`${tenant}/${carpeta}/`) &&
  /^[a-z0-9-]+\/[a-z-]+\/[0-9a-f-]{36}\.(png|jpg|webp|svg|mp4|webm|mov)$/.test(ruta)
