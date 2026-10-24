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
  /**
   * Atribución del CONTACTO (contact_attributions, toque vigente), como ÚLTIMO recurso: en
   * producción la mayoría de citas de Calendly llega sin UTMs propios (el webhook del evento no
   * los trae) y la única evidencia de dónde vino esa persona está en el toque del contacto. Va
   * la última del orden de toques: la evidencia capturada en la cita manda sobre la del contacto.
   */
  contactAttribution?: JsonObject | null
  contacts?: { campaign_id?: string | null } | null
}

/**
 * CAUSA del hueco declarada en el resultado (un hueco no es un cero): antes todo colapsaba en
 * `resolved: false` y «sin señas», «campaña desconocida» y «campaña/anuncio con nombre duplicado
 * en Meta» eran indistinguibles para quien mira la pantalla — si el utm_campaign era ambiguo, la
 * acotación por campaña fallaba en silencio y el hueco acababa explicado con la nota equivocada.
 * No cambia nada del emparejamiento: solo nombra lo que ya se decidía sola.
 */
export type MetaCampaignEstado =
  | 'identidad' // resuelta por id (utm_source/utm_id, contacts.campaign_id o la campaña del anuncio)
  | 'nombre' // resuelta por nombre exacto normalizado
  | 'organica' // el utm dice orgánico/direct: no es ads
  | 'sin_campaign' // señales presentes pero la campaña no está en el catálogo (fuera de sync/borrada)
  | 'ambigua' // DOS o más campañas del catálogo comparten el nombre normalizado
  | 'sin_senas' // el toque no lleva ninguna señal de campaña
export type MetaAdEstado =
  | 'toque' // ad_id real de un toque y en el catálogo
  | 'nombre' // nombre de anuncio (del catálogo via utm_content, o declarado por el proveedor)
  | 'ambigua' // el nombre normalizado matchea 2+ anuncios del catálogo
  | 'sin_anuncio' // hay nombre en el toque pero no matchea ninguno del catálogo
  | 'sin_senas' // el toque no lleva ninguna señal de anuncio

export type ResolvedMetaAttribution = {
  campaign: {
    internalId: string | null
    externalId: string | null
    name: string | null
    resolved: boolean
    estado: MetaCampaignEstado
  }
  ad: {
    externalId: string | null
    name: string | null
    resolved: boolean
    estado: MetaAdEstado
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
    input.contactAttribution,
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
  // Los toques SÍ llevan el nombre de la campaña y del anuncio (utm_campaign/utm_content); si la
  // fila de la cita vino vacía, la evidencia del toque vale lo mismo que valía la columna.
  const utmCampaign = clean(input.utm_campaign) ?? firstValue(candidates.map((touch) => touch.utmCampaign))
  const utmContent = clean(input.utm_content) ?? firstValue(candidates.map((touch) => touch.utmContent))
  const campaignExternalId = firstValue([
    campaignIdFromTouch && META_NUMERIC_ID.test(campaignIdFromTouch) ? campaignIdFromTouch : null,
    utmSource && META_NUMERIC_ID.test(utmSource) ? utmSource : null,
  ])
  return { adId, adName, adSetId, campaignExternalId, utmSource, utmCampaign, utmContent }
}

export function resolveMetaAttribution(
  input: MetaAttributionInput,
  catalog: MetaAttributionCatalog
): ResolvedMetaAttribution {
  const found = evidence(input)
  const ad = found.adId ? catalog.ads.find((item) => item.external_id === found.adId) : undefined

  const internalCampaignId = clean(input.contacts?.campaign_id)
  const senalDeCampana = Boolean(found.campaignExternalId || internalCampaignId || clean(found.utmCampaign))
  let campaignEstado: MetaCampaignEstado = 'sin_senas'
  let campaign = found.campaignExternalId
    ? catalog.campaigns.find((item) => item.external_id === found.campaignExternalId)
    : undefined
  if (campaign) campaignEstado = 'identidad'
  if (!campaign && internalCampaignId) {
    campaign = catalog.campaigns.find((item) => item.id === internalCampaignId)
    if (campaign) campaignEstado = 'identidad'
  }
  if (!campaign && ad?.campaign_external_id) {
    campaign = catalog.campaigns.find((item) => item.external_id === ad.campaign_external_id)
    if (campaign) campaignEstado = 'identidad'
  }
  if (!campaign) {
    const result = resolverCampanaPorUtm(found.utmCampaign, catalog.campaigns, { utmSource: found.utmSource })
    if (result.ok && result.kind === 'directa') {
      campaign = catalog.campaigns.find((item) => item.id === result.campaignId)
      campaignEstado = 'nombre'
    } else if (!result.ok) {
      campaignEstado = 'ambigua'
    } else if (result.kind === 'organica') {
      campaignEstado = 'organica'
    } else {
      // 'sin_campaign' del resolver incluye «sin nombre en el toque»: sin señal real se declara tal cual.
      campaignEstado = senalDeCampana ? 'sin_campaign' : 'sin_senas'
    }
  }

  // Sin ad_id de un toque real (fbclid/parámetros ocultos), pero utm_content ya trae el nombre
  // del anuncio tal cual Meta lo puso con {{ad.name}} — mismo papel que utm_campaign para la
  // campaña arriba. SOLO se lanza con campaña resuelta CON external_id real: sin ese ancla la
  // búsqueda acotada a «todas las campañas» puede engullir silenciosamente el homónimo de OTRA
  // campaña (exacto el caso de utm_campaign ambiguo que motivó este estado) — se declara
  // 'sin_anuncio' y el diagnóstico lo dice la campaign.estado.
  let adPorUtm: MetaAdReference | undefined
  let resultadoAnuncio: ReturnType<typeof resolverAnuncioPorUtm> | null = null
  const anclaCampana = campaign?.external_id ?? null
  if (!ad && !found.adName && found.utmContent && anclaCampana) {
    resultadoAnuncio = resolverAnuncioPorUtm(found.utmContent, catalog.ads, {
      campaignExternalId: anclaCampana,
    })
    if (resultadoAnuncio.ok && resultadoAnuncio.kind === 'directa') {
      const idDelAnuncio = resultadoAnuncio.adExternalId
      adPorUtm = catalog.ads.find((item) => item.external_id === idDelAnuncio)
    }
  }
  const adResuelto = ad ?? adPorUtm

  let adEstado: MetaAdEstado
  if (ad) adEstado = 'toque'
  else if (adPorUtm) adEstado = 'nombre'
  else if (resultadoAnuncio)
    adEstado = !resultadoAnuncio.ok && resultadoAnuncio.kind === 'ambigua' ? 'ambigua' : 'sin_anuncio'
  else if (found.adName)
    adEstado = 'nombre' // declarado por el proveedor, sin pasarlo por el catálogo
  else if (clean(found.utmContent))
    adEstado = 'sin_anuncio' // señal presente pero sin ancla de campaña
  else adEstado = 'sin_senas'

  return {
    campaign: {
      internalId: campaign?.id ?? internalCampaignId,
      externalId: campaign?.external_id ?? found.campaignExternalId ?? ad?.campaign_external_id ?? null,
      name: campaign?.name ?? null,
      resolved: Boolean(campaign),
      estado: campaignEstado,
    },
    ad: {
      externalId: found.adId ?? adResuelto?.external_id ?? null,
      name: adResuelto?.name ?? found.adName,
      resolved: Boolean(adResuelto || found.adName),
      estado: adEstado,
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
