// CSS de Google Fonts para incrustar tipografías en el PNG/vídeo exportado.
//
// Google responde 400 si se pide un peso que la familia no tiene (DM Serif Display o Anton solo
// existen en 400). Pedir los mismos pesos a todas las familias dejaba el CSS vacío y la exportación
// caía a la tipografía por defecto. Por eso se pide familia a familia y, si falla, con menos pesos.

const ESPECIFICACIONES = [':wght@300;400;500;600;700;800;900', ':wght@400;700', ''] as const

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

// Caché en memoria por instancia: el CSS de una familia no cambia entre exportaciones y evita repetir
// los intentos fallidos con pesos que la familia no tiene. Acotada para no crecer sin límite.
const CACHE = new Map<string, string>()
const MAX_CACHE = 64

export function vaciarCacheFuentes(): void {
  CACHE.clear()
}

export async function cssDeFamilia(familia: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const guardado = CACHE.get(familia)
  if (guardado !== undefined) return guardado
  const css = await pedirCss(familia, fetchImpl)
  // Solo se cachea lo que salió bien: un fallo de red puntual no debe quedar fijado.
  if (css) {
    if (CACHE.size >= MAX_CACHE) CACHE.clear()
    CACHE.set(familia, css)
  }
  return css
}

async function pedirCss(familia: string, fetchImpl: typeof fetch): Promise<string> {
  for (const espec of ESPECIFICACIONES) {
    const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(familia)}${espec}&display=swap`
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': UA } })
      if (res.ok) {
        const css = await res.text()
        if (css.includes('@font-face')) return css
      }
    } catch {
      /* se prueba con menos pesos */
    }
  }
  return ''
}

export async function cssDeFuentes(familias: string[], fetchImpl: typeof fetch = fetch): Promise<string> {
  const unicas = [...new Set(familias.map((f) => f.trim()).filter(Boolean))].slice(0, 12)
  const partes = await Promise.all(unicas.map((f) => cssDeFamilia(f, fetchImpl)))
  return partes.filter(Boolean).join('\n')
}
