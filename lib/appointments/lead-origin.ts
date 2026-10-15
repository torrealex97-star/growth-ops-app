export type AppointmentLeadOriginKind = 'setter' | 'collaborator' | 'ads' | 'organic' | 'web' | 'unknown'

export type AppointmentLeadOrigin = {
  kind: AppointmentLeadOriginKind
  shortLabel: 'SET' | 'COLAB' | 'ADS' | 'ORG' | 'WEB' | '—'
  label: string
  detail: string
}

type LeadOriginInput = {
  setterId?: string | null
  setterName?: string | null
  contactSetSource?: string | null
  collaboratorName?: string | null
  hasCollaboratorAttribution?: boolean
  attributionLoaded: boolean
  source?: string | null
  externalSource?: string | null
  utmSource?: string | null
  utmMedium?: string | null
  /**
   * `true` si la cita se resolvió contra un anuncio o campaña de Meta (id de anuncio/campaña o nombre).
   * Es evidencia más fuerte que cualquier texto de UTM.
   */
  evidenciaAnuncio?: boolean
}

// Medios que significan «pago»: lo que Meta/Google rellenan en utm_medium para anuncios.
const MEDIO_DE_PAGO = /^(paid|paid[\s_-]?social|paid[\s_-]?search|cpc|ppc|cpm|cpv|ads?|display|social[\s_-]?paid)$/i
// Medios que, aun con una red social de fuente, indican tráfico ORGÁNICO (el enlace de la bio, un post…).
const MEDIO_ORGANICO =
  /^(bio|link[\s_-]?in[\s_-]?bio|organic|organic[\s_-]?(social|search)|social|story|stories|profile|referral|embed[\w-]*|email|newsletter|dm)$/i
// Redes de Meta: como fuente, solo son anuncios si el medio no es claramente orgánico.
const FUENTE_META = new Set([
  'facebook',
  'fb',
  'meta',
  'meta_ads',
  'facebook_ads',
  'ig',
  'instagram',
  'instagram_ads',
  'an',
  'audience_network',
  'messenger',
])
// Redes sociales (Meta y otras) que, con un medio orgánico (bio, story, perfil…), son social ORGÁNICO.
const RED_SOCIAL = /^(ig|instagram|fb|facebook|tk|tiktok|yt|youtube|threads|x|twitter|linkedin)$/i
// Meta suele meter el id del anuncio en utm_source ({{ad.id}}): un número largo es un anuncio.
const ID_NUMERICO_META = /^\d{12,}$/

/**
 * ¿Esta cita viene de un ANUNCIO? Evidencia, por orden: el anuncio/campaña resuelto, un medio de pago,
 * un id de anuncio en la fuente, o una red de Meta como fuente sin un medio orgánico que lo desmienta.
 * «direct», «google/organic», «linktr.ee», un enlace de bio o un referido NO son anuncios.
 */
export function esOrigenAnuncio(input: Pick<LeadOriginInput, 'utmSource' | 'utmMedium' | 'evidenciaAnuncio'>): boolean {
  if (input.evidenciaAnuncio) return true
  const medio = (input.utmMedium || '').trim()
  const fuente = (input.utmSource || '').trim()
  if (medio && MEDIO_DE_PAGO.test(medio)) return true
  if (fuente && ID_NUMERICO_META.test(fuente)) return true
  if (fuente && FUENTE_META.has(fuente.toLowerCase()) && !MEDIO_ORGANICO.test(medio)) return true
  return false
}

/**
 * Resume la procedencia comercial que necesita el closer antes de abrir una cita.
 * La relación estructurada gana sobre textos/UTMs; si la atribución no pudo leerse,
 * no se presenta el hueco como WEB porque "desconocido" y "directo" no son lo mismo.
 */
export function resolveAppointmentLeadOrigin(input: LeadOriginInput): AppointmentLeadOrigin {
  if (input.setterId || input.contactSetSource === 'setter' || input.contactSetSource === 'cold_caller') {
    return {
      kind: 'setter',
      shortLabel: 'SET',
      label: 'Setter',
      detail: input.setterName ? `Setter · ${input.setterName}` : 'Setter / prospección del equipo',
    }
  }

  if (input.hasCollaboratorAttribution || input.contactSetSource === 'affiliate') {
    return {
      kind: 'collaborator',
      shortLabel: 'COLAB',
      label: 'Colaborador',
      detail: input.collaboratorName ? `Colaborador · ${input.collaboratorName}` : 'Colaborador / afiliado',
    }
  }

  if (!input.attributionLoaded) {
    return {
      kind: 'unknown',
      shortLabel: '—',
      label: 'Origen no disponible',
      detail: 'No se pudo leer la atribución de este contacto',
    }
  }

  // `externalSource` y valores como calendly/ghl describen quién creó el REGISTRO, no cómo se
  // adquirió el lead. Ausencia de UTM tampoco demuestra tráfico directo u orgánico. Solo mostramos
  // WEB cuando existe una señal de adquisición; el resto queda explícitamente sin atribuir.
  // En esta pantalla `source`/`externalSource` proceden de la agenda, así que son record source.
  // La única señal de adquisición que recibe este resolver es `utmSource`; el resto de la
  // trayectoria se consulta en la ficha del contacto sin rellenar este badge con inferencias.
  const channel = input.utmSource
  if (!channel && input.evidenciaAnuncio) {
    return { kind: 'ads', shortLabel: 'ADS', label: 'Ads', detail: 'Ads · anuncio de Meta resuelto' }
  }
  if (!channel) {
    return {
      kind: 'unknown',
      shortLabel: '—',
      label: 'Sin atribuir',
      detail: 'No hay una fuente de adquisición verificable',
    }
  }

  // ADS: lo que viene de un anuncio lo dice. WEB queda para el resto con señal de adquisición
  // (directo, SEO, referidos, enlaces de bio).
  if (esOrigenAnuncio(input)) {
    return {
      kind: 'ads',
      shortLabel: 'ADS',
      label: 'Ads',
      detail: ID_NUMERICO_META.test(channel.trim()) ? `Ads · anuncio ${channel.trim()}` : `Ads · ${channel}`,
    }
  }

  // ORG: una red social con medio orgánico explícito (IG/Bio, TikTok/story…). Un enlace de linktree
  // o «direct» sigue siendo WEB: sin red social identificable no se afirma que sea social orgánico.
  if (RED_SOCIAL.test(channel.trim()) && MEDIO_ORGANICO.test((input.utmMedium || '').trim())) {
    return { kind: 'organic', shortLabel: 'ORG', label: 'Orgánico', detail: `Orgánico · ${channel}` }
  }

  return {
    kind: 'web',
    shortLabel: 'WEB',
    label: 'Web',
    detail: `Web · ${channel}`,
  }
}
