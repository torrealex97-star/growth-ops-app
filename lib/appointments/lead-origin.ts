export type AppointmentLeadOriginKind = 'setter' | 'collaborator' | 'web' | 'unknown'

export type AppointmentLeadOrigin = {
  kind: AppointmentLeadOriginKind
  shortLabel: 'SET' | 'COLAB' | 'WEB' | '—'
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

  const channel = input.utmSource || input.source || input.externalSource
  return {
    kind: 'web',
    shortLabel: 'WEB',
    label: 'Web / directo',
    detail: channel ? `Web / directo · ${channel}` : 'Web / directo',
  }
}
