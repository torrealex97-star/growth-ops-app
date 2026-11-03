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
    const creado = await sb.storage.createBucket(BUCKET_CARRUSELES, {
      public: true,
      fileSizeLimit: MAX_VIDEO,
      allowedMimeTypes: [...MIME_IMAGEN, ...MIME_VIDEO],
    })
    if (creado.error && !/already exists/i.test(creado.error.message))
      return { error: `No se pudo crear el almacén de archivos: ${creado.error.message}`, url: '' }
    r = await subir()
  }
  if (r.error) return { error: r.error.message, url: '' }
  return { error: null, url: sb.storage.from(BUCKET_CARRUSELES).getPublicUrl(ruta).data.publicUrl }
}
