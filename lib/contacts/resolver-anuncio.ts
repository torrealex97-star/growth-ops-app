// RESOLVER DE ANUNCIO POR utm_content (mismo patrón declarativo que resolver-campana.ts).
//
// EL PROBLEMA: resolveMetaAttribution() solo nombra un anuncio cuando hay un ad_id capturado en
// un toque real (clic con tracking completo). Sin ese id — el caso de cualquier lead que llega
// solo con los UTM del formulario/landing, sin fbclid ni parámetros ocultos — el anuncio quedaba
// "no identificado" aunque utm_content YA llevara el nombre real del anuncio (Meta lo pone ahí
// con la variable dinámica {{ad.name}}, igual que utm_campaign lleva {{campaign.name}}).
//
// LAS MISMAS REGLAS que resolver-campana, nada de fuzzy matching:
//   1. Normalización verificable: '+' → espacio, colapsar espacios, minúsculas.
//   2. Match EXACTO sobre el nombre normalizado, ACOTADO a la campaña ya resuelta si se conoce
//      (comprobado en producción: el mismo nombre de anuncio se reutiliza en campañas distintas —
//      "ad2 | ... | midl funnel" existe en 3 campañas con external_id distintos — así que sin
//      acotar por campaña, un nombre nunca sería unívoco).
//   3. AMBIGUO (incluso dentro de la misma campaña: variantes/placements duplican el ad_id con el
//      mismo nombre) → `{ ok: false, kind: 'ambigua' }`, nunca se adivina cuál.
//
// Puro y testeable sin BD, igual que su hermano de campañas.

export type AnuncioCatalogo = { external_id: string; name: string; campaign_external_id: string | null }

export type ResultadoAnuncio =
  | { ok: true; kind: 'directa'; adExternalId: string }
  | { ok: true; kind: 'sin_anuncio' }
  | { ok: false; kind: 'ambigua'; candidates: string[] }

export function normalizarUtmContent(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function resolverAnuncioPorUtm(
  utmContent: string | null | undefined,
  catalogo: AnuncioCatalogo[],
  identidad?: { campaignExternalId?: string | null }
): ResultadoAnuncio {
  const normalizado = normalizarUtmContent(utmContent)
  if (!normalizado) return { ok: true, kind: 'sin_anuncio' }

  const ambito = identidad?.campaignExternalId
    ? catalogo.filter((a) => a.campaign_external_id === identidad.campaignExternalId)
    : catalogo

  const candidates: string[] = []
  for (const a of ambito) {
    if (normalizarUtmContent(a.name) === normalizado) candidates.push(a.external_id)
  }
  if (candidates.length === 0) return { ok: true, kind: 'sin_anuncio' }
  if (candidates.length > 1) return { ok: false, kind: 'ambigua', candidates }
  return { ok: true, kind: 'directa', adExternalId: candidates[0] }
}
