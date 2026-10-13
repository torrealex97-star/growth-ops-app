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

  // `externalSource` y valores como calendly/ghl describen quién creó el REGISTRO, no cómo se
  // adquirió el lead. Ausencia de UTM tampoco demuestra tráfico directo u orgánico. Solo mostramos
  // WEB cuando existe una señal de adquisición; el resto queda explícitamente sin atribuir.
  // En esta pantalla `source`/`externalSource` proceden de la agenda, así que son record source.
  // La única señal de adquisición que recibe este resolver es `utmSource`; el resto de la
  // trayectoria se consulta en la ficha del contacto sin rellenar este badge con inferencias.
  const channel = input.utmSource
  if (!channel) {
    return {
      kind: 'unknown',
      shortLabel: '—',
      label: 'Sin atribuir',
      detail: 'No hay una fuente de adquisición verificable',
    }
  }

  return {
    kind: 'web',
    shortLabel: 'WEB',
    label: 'Web',
    detail: `Web · ${channel}`,
  }
}
