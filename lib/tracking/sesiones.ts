// SESIONES DEL PÍXEL: personas distintas que llegan, no filas de evento.
//
// Una recarga, un botón «atrás» o dos pestañas generan varios `page_view` de la misma sesión. Contar
// filas infla las visitas (medido el 17-oct: 161 eventos para 132 sesiones el mismo día) y descuadra la
// comparación con Meta, que cuenta personas. Además se separa cuántas sesiones llegaron DE ANUNCIO
// (el enlace lleva `fbclid` o un utm de pago), que es lo único comparable con `landing_page_view`.
// Idea tomada del embudo por sesión de Umami (MIT): el recuento es por sesión, no por evento.
// Puro: sin base de datos.

import { esOrigenAnuncio } from '@/lib/appointments/lead-origin'

export type FilaPixel = { session_id: string | null; url: string | null }

export type SesionesPixel = {
  /** Sesiones distintas (una fila sin sesión cuenta como una sesión propia: no se descarta tráfico). */
  total: number
  /** Sesiones con al menos un evento cuyo enlace indica anuncio. */
  ads: number
}

function esEnlaceDeAnuncio(url: string | null): boolean {
  if (!url) return false
  let q: URLSearchParams
  try {
    q = new URL(url, 'https://x.invalid').searchParams
  } catch {
    return false
  }
  if (q.get('fbclid')) return true
  return esOrigenAnuncio({ utmSource: q.get('utm_source'), utmMedium: q.get('utm_medium') })
}

export function contarSesionesPixel(filas: readonly FilaPixel[]): SesionesPixel {
  const sesiones = new Map<string, boolean>()
  let sinSesion = 0
  let sinSesionAds = 0
  for (const f of filas) {
    const ad = esEnlaceDeAnuncio(f.url)
    if (!f.session_id) {
      sinSesion++
      if (ad) sinSesionAds++
      continue
    }
    sesiones.set(f.session_id, (sesiones.get(f.session_id) ?? false) || ad)
  }
  return {
    total: sesiones.size + sinSesion,
    ads: [...sesiones.values()].filter(Boolean).length + sinSesionAds,
  }
}
