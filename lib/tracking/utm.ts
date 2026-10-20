// GENERADOR Y VALIDADOR DE UTMs. Causa raíz de que contact_attributions quede vacía: los enlaces de
// anuncios y landings salen sin UTMs (o con ellas mal escritas) y el tracker no tiene nada que
// capturar. Puro y sin I/O.

export type ParametrosUtm = {
  source: string
  medium: string
  campaign: string
  content?: string
  term?: string
}

/** Macros dinámicas de Meta Ads: se escriben literales, Meta las sustituye al servir el anuncio. */
export const MACROS_META = {
  campaign: '{{campaign.name}}',
  adset: '{{adset.name}}',
  ad: '{{ad.name}}',
  campaignId: '{{campaign.id}}',
  adsetId: '{{adset.id}}',
  adId: '{{ad.id}}',
} as const

/**
 * Cadena para el campo «Parámetros de URL» de Meta Ads. NO se codifica: Meta espera las llaves
 * `{{...}}` tal cual. Incluye los IDs (campaign_id/adset_id/ad_id) que el tracker ya captura, que
 * resuelven el anuncio exacto aunque el nombre cambie.
 */
export function parametrosMeta(): string {
  return [
    'utm_source=facebook',
    'utm_medium=paid_social',
    `utm_campaign=${MACROS_META.campaign}`,
    `utm_content=${MACROS_META.ad}`,
    `utm_term=${MACROS_META.adset}`,
    `campaign_id=${MACROS_META.campaignId}`,
    `adset_id=${MACROS_META.adsetId}`,
    `ad_id=${MACROS_META.adId}`,
  ].join('&')
}

const limpio = (v: string | undefined) => (v ?? '').trim().replace(/\s+/g, '-').toLowerCase()

export type ResultadoUrl = { ok: true; url: string } | { ok: false; error: string }

/** URL final con UTMs estáticas. Normaliza a minúsculas sin espacios (GA/Meta distinguen mayúsculas). */
export function construirUrlUtm(base: string, p: ParametrosUtm): ResultadoUrl {
  let url: URL
  try {
    url = new URL(base.trim())
  } catch {
    return { ok: false, error: 'La URL base no es válida (incluye https://).' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, error: 'Usa una URL http(s).' }
  const source = limpio(p.source)
  const medium = limpio(p.medium)
  const campaign = limpio(p.campaign)
  if (!source || !medium || !campaign) return { ok: false, error: 'Origen, medio y campaña son obligatorios.' }
  url.searchParams.set('utm_source', source)
  url.searchParams.set('utm_medium', medium)
  url.searchParams.set('utm_campaign', campaign)
  const content = limpio(p.content)
  const term = limpio(p.term)
  if (content) url.searchParams.set('utm_content', content)
  if (term) url.searchParams.set('utm_term', term)
  return { ok: true, url: url.toString() }
}

export type AvisoUtm = { nivel: 'error' | 'aviso'; mensaje: string }

/** Revisa un enlace ya existente y dice qué le falta para poder atribuirse. */
export function validarUrlUtm(raw: string): AvisoUtm[] {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return [{ nivel: 'error', mensaje: 'La URL no es válida.' }]
  }
  const avisos: AvisoUtm[] = []
  const q = url.searchParams
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) {
    if (!q.get(k)) avisos.push({ nivel: 'error', mensaje: `Falta ${k}: sin él el lead queda sin origen.` })
  }
  if (!q.get('utm_content')) {
    avisos.push({ nivel: 'aviso', mensaje: 'Sin utm_content no se sabrá qué anuncio exacto trajo al lead.' })
  }
  for (const [k, v] of q.entries()) {
    if (!k.startsWith('utm_')) continue
    if (v !== v.trim() || /\s/.test(v)) avisos.push({ nivel: 'aviso', mensaje: `${k} contiene espacios.` })
    if (/\{\{.*\}\}/.test(v) && !/^\{\{[a-z.]+\}\}$/.test(v)) {
      avisos.push({ nivel: 'aviso', mensaje: `${k} tiene una macro mal formada.` })
    }
    if (v !== v.toLowerCase() && !/\{\{/.test(v)) {
      avisos.push({
        nivel: 'aviso',
        mensaje: `${k} tiene mayúsculas: «${v}» y «${v.toLowerCase()}» cuentan como fuentes distintas.`,
      })
    }
  }
  return avisos
}
