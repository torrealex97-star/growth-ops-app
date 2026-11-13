// Estados de un lead en el cold calling. Sin dependencias de servidor: lo usan igual la API
// (validación, comisión) y la pantalla (botones). La lista coincide con el CHECK de
// `cold_calling_assignments.status` (migración 20261110110000) y un test lo comprueba.

export type EstadoLead =
  | 'pendiente'
  | 'no_contesta'
  | 'whatsapp'
  | 'llamado'
  | 'confirmado'
  | 'no_interesado'
  | 'no_existe'
  | 'asiste'
  | 'no_asiste'
  | 'nutricion'

export type TonoEstado = 'neutro' | 'aviso' | 'info' | 'bien' | 'mal'

export const ESTADOS: {
  id: EstadoLead
  label: string
  /** Qué significa, para quien lo marca por primera vez. */
  ayuda: string
  /** Cuenta como llamada hecha: es lo que da derecho a comisión si ese lead compra después. */
  llamada: boolean
  tono: TonoEstado
}[] = [
  { id: 'pendiente', label: 'Por llamar', ayuda: 'Aún no lo has intentado.', llamada: false, tono: 'neutro' },
  {
    id: 'no_contesta',
    label: 'No contesta',
    ayuda: 'Has llamado y no ha cogido. Vuelve a intentarlo a otra hora.',
    llamada: true,
    tono: 'aviso',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp enviado',
    ayuda: 'Le has escrito pero no has llamado. Un mensaje no cuenta como llamada.',
    llamada: false,
    tono: 'info',
  },
  { id: 'llamado', label: 'Hablado', ayuda: 'Has hablado con la persona.', llamada: true, tono: 'info' },
  { id: 'confirmado', label: 'Confirma', ayuda: 'Te ha dicho que asistirá.', llamada: true, tono: 'bien' },
  {
    id: 'nutricion',
    label: 'Más adelante',
    ayuda: 'Le interesa pero no ahora. Ponle un recordatorio para retomarlo.',
    llamada: true,
    tono: 'info',
  },
  { id: 'asiste', label: 'Asistió', ayuda: 'Fue al evento.', llamada: true, tono: 'bien' },
  { id: 'no_asiste', label: 'No asistió', ayuda: 'Confirmó pero no fue.', llamada: true, tono: 'mal' },
  { id: 'no_interesado', label: 'No le interesa', ayuda: 'Te ha dicho que no.', llamada: true, tono: 'neutro' },
  {
    id: 'no_existe',
    label: 'Número erróneo',
    ayuda: 'El teléfono no existe o no es de esa persona.',
    llamada: true,
    tono: 'mal',
  },
]

export const ESTADO_IDS: EstadoLead[] = ESTADOS.map((e) => e.id)
export const esEstado = (v: unknown): v is EstadoLead => typeof v === 'string' && ESTADO_IDS.includes(v as EstadoLead)

/** Estados que prueban que hubo llamada. WhatsApp solo no cuenta: no es una llamada. */
export const ESTADOS_LLAMADA: EstadoLead[] = ESTADOS.filter((e) => e.llamada).map((e) => e.id)

/** Estados que cuentan como confirmado (la primera vez se guarda en confirmed_at). */
export const ESTADOS_CONFIRMA: EstadoLead[] = ['confirmado', 'asiste']

/** Hubo conversación de verdad (descuelga y se habla). */
export const ESTADOS_CONTACTADO: EstadoLead[] = [
  'llamado',
  'confirmado',
  'no_interesado',
  'asiste',
  'no_asiste',
  'nutricion',
]

/** Ya no hay nada más que hacer con el lead: sale de "por trabajar". */
export const ESTADOS_CERRADOS: EstadoLead[] = ['no_interesado', 'no_existe', 'asiste', 'no_asiste']

export const estadoDe = (id: string) => ESTADOS.find((e) => e.id === id) ?? ESTADOS[0]
