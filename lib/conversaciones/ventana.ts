// VENTANA DE MENSAJERÍA (pura). Patrón tomado de `Conversations::MessageWindowService` de Chatwoot (MIT).
//
// Meta solo deja responder gratis durante 24 h desde el ÚLTIMO mensaje del lead. La etiqueta HUMAN_AGENT
// amplía a 7 días, pero SOLO si escribe una persona: un agente de IA nunca puede usarla. Por eso la
// pregunta «¿puede responder?» depende de quién va a responder, y aquí se decide en un único sitio.

export type Canal = 'instagram' | 'facebook' | 'whatsapp' | 'tiktok' | 'sms' | 'email' | 'chat' | string
export type Autor = 'humano' | 'ia'

const HORA = 3_600_000

/** Horas de ventana por canal para quien responde. `null` = sin ventana propia (SMS, email). */
export function horasDeVentana(canal: Canal, autor: Autor): number | null {
  switch (canal) {
    case 'instagram':
    case 'facebook':
      return autor === 'humano' ? 24 * 7 : 24
    case 'whatsapp':
      return 24
    case 'tiktok':
      return 48
    default:
      return null
  }
}

export type VentanaEstado = { abierta: boolean; expiraEn: string | null; motivo: string }

/**
 * ¿Se puede responder ahora? `ultimoEntrante` es la fecha del último mensaje del LEAD. Sin él no hay ventana
 * (nunca se escribe en frío). Un canal sin ventana propia (SMS/email) queda abierto, pero la IA solo actúa en
 * los canales de mensajería directa: eso lo decide `canalesAutorizadosParaIA`.
 */
export function estadoVentana(
  canal: Canal,
  autor: Autor,
  ultimoEntrante: string | null | undefined,
  ahora: Date = new Date()
): VentanaEstado {
  const horas = horasDeVentana(canal, autor)
  if (horas === null) return { abierta: true, expiraEn: null, motivo: 'canal sin ventana propia' }
  const t = ultimoEntrante ? Date.parse(ultimoEntrante) : NaN
  if (!Number.isFinite(t))
    return { abierta: false, expiraEn: null, motivo: 'el lead aún no ha escrito: no se escribe en frío' }
  const expira = t + horas * HORA
  const abierta = ahora.getTime() < expira
  return {
    abierta,
    expiraEn: new Date(expira).toISOString(),
    motivo: abierta ? `ventana de ${horas} h abierta` : `ventana de ${horas} h cerrada`,
  }
}

/** Canales donde el agente de IA puede actuar. TikTok queda fuera: su API de mensajería no está disponible en el EEE. */
export const CANALES_IA: readonly Canal[] = ['instagram', 'facebook']
export const canalAutorizadoParaIA = (canal: Canal): boolean => CANALES_IA.includes(canal)
