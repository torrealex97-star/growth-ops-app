import { leerToque, type ToqueAtribucion } from '@/lib/contacts/atribucion'
import { resolverCampanaPorUtm } from '@/lib/contacts/resolver-campana'
import { resolverAnuncioPorUtm } from '@/lib/contacts/resolver-anuncio'

type JsonObject = Record<string, unknown>

export type MetaCampaignReference = {
  id: string
  external_id: string | null
  name: string
}

export type MetaAdReference = {
  external_id: string
  campaign_external_id: string | null
  name: string
  adset_name: string | null
}

export type MetaAttributionCatalog = {
  campaigns: MetaCampaignReference[]
  ads: MetaAdReference[]
}

export type MetaAttributionInput = {
  utm_source?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  raw_payload?: JsonObject | null
  attribution_first?: JsonObject | null
  attribution_second?: JsonObject | null
  attribution_last?: JsonObject | null
  attribution_booking?: JsonObject | null
  contacts?: { campaign_id?: string | null } | null
}

export type ResolvedMetaAttribution = {
  campaign: {
    internalId: string | null
    externalId: string | null
    name: string | null
    resolved: boolean
  }
  ad: {
    externalId: string | null
    name: string | null
    resolved: boolean
  }
  adSet: {
    externalId: string | null
    name: string | null
  }
}

export type MetaAttributionSignals = {
  campaignExternalIds: string[]
  campaignInternalIds: string[]
  adExternalIds: string[]
}

const META_NUMERIC_ID = /^\d{10,30}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const clean = (value: string | null | undefined): string | null => {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

/**
 * Orden operativo: la evidencia capturada al reservar es la más cercana a la agenda; después
 * conservamos el último toque y, por último, el origen inicial. No se deduce nunca un anuncio a
 * partir del conjunto o la campaña: sin `ad_id`, el anuncio queda explícitamente desconocido.
 */
function touches(input: MetaAttributionInput): ToqueAtribucion[] {
  const values = [
    input.attribution_booking,
    input.attribution_last,
    input.attribution_first,
    input.attribution_second,
    input.raw_payload,
  ]
  return values.filter(Boolean).map((value) => leerToque(value))
}

function firstValue(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = clean(value)
    if (normalized) return normalized
  }
  return null
}

function evidence(input: MetaAttributionInput) {
  const candidates = touches(input)
  const adId = firstValue(candidates.map((touch) => touch.adId))
  const adName = firstValue(candidates.map((touch) => touch.adName))
  const adSetId = firstValue(candidates.map((touch) => touch.adSetId))
  const campaignIdFromTouch = firstValue(candidates.map((touch) => touch.utmId))
  const utmSource = clean(input.utm_source) ?? firstValue(candidates.map((touch) => touch.utmSource))
  const campaignExternalId = firstValue([
    campaignIdFromTouch && META_NUMERIC_ID.test(campaignIdFromTouch) ? campaignIdFromTouch : null,
    utmSource && META_NUMERIC_ID.test(utmSource) ? utmSource : null,
  ])
  return { adId, adName, adSetId, campaignExternalId, utmSource }
}

export function resolveMetaAttribution(
  input: MetaAttributionInput,
  catalog: MetaAttributionCatalog
): ResolvedMetaAttribution {
  const found = evidence(input)
  const ad = found.adId ? catalog.ads.find((item) => item.external_id === found.adId) : undefined

  const internalCampaignId = clean(input.contacts?.campaign_id)
  let campaign = found.campaignExternalId
    ? catalog.campaigns.find((item) => item.external_id === found.campaignExternalId)
    : undefined
  if (!campaign && internalCampaignId) campaign = catalog.campaigns.find((item) => item.id === internalCampaignId)
  if (!campaign && ad?.campaign_external_id) {
    campaign = catalog.campaigns.find((item) => item.external_id === ad.campaign_external_id)
  }
  if (!campaign) {
    const result = resolverCampanaPorUtm(input.utm_campaign, catalog.campaigns, { utmSource: found.utmSource })
    if (result.ok && result.kind === 'directa') {
      campaign = catalog.campaigns.find((item) => item.id === result.campaignId)
    }
  }

  // Sin ad_id de un toque real (fbclid/parámetros ocultos), pero utm_content ya trae el nombre
  // del anuncio tal cual Meta lo puso con {{ad.name}} — mismo papel que utm_campaign para la
  // campaña arriba. Acotado a la campaña ya resuelta para no confundir anuncios homónimos de
  // campañas distintas (comprobado en producción, ver resolver-anuncio.ts).
  let adPorUtm: MetaAdReference | undefined
  if (!ad && !found.adName && input.utm_content) {
    const resultadoAnuncio = resolverAnuncioPorUtm(input.utm_content, catalog.ads, {
      campaignExternalId: campaign?.external_id ?? found.campaignExternalId ?? null,
    })
    if (resultadoAnuncio.ok && resultadoAnuncio.kind === 'directa') {
      adPorUtm = catalog.ads.find((item) => item.external_id === resultadoAnuncio.adExternalId)
    }
  }
  const adResuelto = ad ?? adPorUtm

  return {
    campaign: {
      internalId: campaign?.id ?? internalCampaignId,
      externalId: campaign?.external_id ?? found.campaignExternalId ?? ad?.campaign_external_id ?? null,
      name: campaign?.name ?? null,
      resolved: Boolean(campaign),
    },
    ad: {
      externalId: found.adId ?? adResuelto?.external_id ?? null,
      name: adResuelto?.name ?? found.adName,
      resolved: Boolean(adResuelto || found.adName),
    },
    adSet: {
      externalId: found.adSetId,
      name: adResuelto?.adset_name ?? null,
    },
  }
}

/**
 * La ruta del catálogo rechaza (400) más de 300 IDs por tipo. Con un histórico largo se superaba y
 * TODAS las filas salían «no identificado» sin aviso: se parte en peticiones de como mucho `max` IDs
 * por tipo, que luego se fusionan.
 */
export function trocearSenales(signals: MetaAttributionSignals, max = 300): MetaAttributionSignals[] {
  const n = Math.max(
    1,
    Math.ceil(signals.campaignExternalIds.length / max),
    Math.ceil(signals.campaignInternalIds.length / max),
    Math.ceil(signals.adExternalIds.length / max)
  )
  const bloques: MetaAttributionSignals[] = []
  for (let i = 0; i < n; i++) {
    const trozo = (xs: string[]) => xs.slice(i * max, (i + 1) * max)
    const bloque = {
      campaignExternalIds: trozo(signals.campaignExternalIds),
      campaignInternalIds: trozo(signals.campaignInternalIds),
      adExternalIds: trozo(signals.adExternalIds),
    }
    if (bloque.campaignExternalIds.length || bloque.campaignInternalIds.length || bloque.adExternalIds.length) {
      bloques.push(bloque)
    }
  }
  return bloques
}

export function collectMetaAttributionSignals(inputs: MetaAttributionInput[]): MetaAttributionSignals {
  const campaignExternalIds = new Set<string>()
  const campaignInternalIds = new Set<string>()
  const adExternalIds = new Set<string>()

  for (const input of inputs) {
    const found = evidence(input)
    if (found.campaignExternalId) campaignExternalIds.add(found.campaignExternalId)
    const internalId = clean(input.contacts?.campaign_id)
    if (internalId && UUID.test(internalId)) campaignInternalIds.add(internalId)
    if (found.adId && META_NUMERIC_ID.test(found.adId)) adExternalIds.add(found.adId)
  }

  return {
    campaignExternalIds: [...campaignExternalIds],
    campaignInternalIds: [...campaignInternalIds],
    adExternalIds: [...adExternalIds],
  }
}
