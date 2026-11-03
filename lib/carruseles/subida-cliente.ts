import type { CarpetaSubida } from './almacen'

/**
 * Sube un archivo DIRECTO al almacén (sin pasar por nuestras rutas, que Vercel limita a ~4,5 MB). Devuelve la ruta y la URL
 * pública; quien llama la registra donde corresponda (proyecto, ejemplos, marca…).
 */
export async function subirDirecto(
  tenant: string,
  file: File,
  carpeta: CarpetaSubida,
  f: typeof fetch = fetch
): Promise<{ path: string; url: string }> {
  const r = await f(`/api/${tenant}/evergreen/carruseles/upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mime: file.type, size: file.size, carpeta }),
  })
  const j = (await r.json().catch(() => ({}))) as { path?: string; url?: string; signedUrl?: string; error?: string }
  if (!r.ok || !j.signedUrl || !j.path || !j.url) throw new Error(j.error || 'No se pudo preparar la subida')
  // Mismo formato que usa la librería de Supabase para subir a una dirección firmada.
  const cuerpo = new FormData()
  cuerpo.append('cacheControl', '3600')
  cuerpo.append('', file)
  const put = await f(j.signedUrl, { method: 'PUT', body: cuerpo, headers: { 'x-upsert': 'false' } })
  if (!put.ok) throw new Error('No se pudo subir el archivo. Inténtalo de nuevo.')
  return { path: j.path, url: j.url }
}
