import type { Lanzamiento } from './lanzamientos'

// CONEXIÓN DEL LANZAMIENTO CON GHL, contada desde la propia pantalla de Lanzamientos.
//
// La dirección del webhook y su estado solo se veían en Configuración → Integraciones, que es una
// pantalla de administración: quien montaba el lanzamiento no podía ni ver a qué dirección tenía que
// apuntar GHL, y las variantes `?evento=` no se pintaban en ningún sitio (había que componerlas a
// mano leyendo un párrafo). Aquí se listan las cuatro, ya montadas, y los pasos de activación con su
// estado real. Función pura: los datos vienen de la ruta.

export const RUTA_WEBHOOK = '/api/{tenant}/evergreen/webhooks/lanzamiento'
export const CABECERA_SECRETO = 'x-ghl-secret'
export const CLAVE_SECRETO = 'LANZAMIENTO_WEBHOOK_SECRET'
export const FUENTE_EVENTOS = 'ghl-launch'

export type EventoWebhook = {
  id: 'alta' | 'encuesta' | 'confirmacion' | 'desconfirmacion'
  titulo: string
  /** Sufijo que se añade a la dirección base. */
  query: string
  /** En qué workflow de GHL va esta acción. */
  cuando: string
  obligatorio: boolean
}

export const EVENTOS_WEBHOOK: EventoWebhook[] = [
  {
    id: 'alta',
    titulo: 'Alta',
    query: '',
    cuando: 'En el workflow que se dispara cuando alguien se registra al evento.',
    obligatorio: true,
  },
  {
    id: 'encuesta',
    titulo: 'Encuesta',
    query: '?evento=encuesta',
    cuando: 'En el workflow que se dispara cuando alguien envía la encuesta previa.',
    obligatorio: false,
  },
  {
    id: 'confirmacion',
    titulo: 'Confirmación',
    query: '?evento=confirmacion',
    cuando: 'En el workflow del botón o respuesta «sí, voy a asistir».',
    obligatorio: false,
  },
  {
    id: 'desconfirmacion',
    titulo: 'Retirar confirmación',
    query: '?evento=desconfirmacion',
    cuando: 'Solo si dejas que alguien se desapunte: retira su confirmación.',
    obligatorio: false,
  },
]

export function rutaWebhook(tenant: string, evento: EventoWebhook): string {
  return `${RUTA_WEBHOOK.replace('{tenant}', encodeURIComponent(tenant))}${evento.query}`
}

export type EstadoPaso = 'hecho' | 'ahora' | 'pendiente'

export type PasoActivacion = {
  id: 'programar' | 'abrir' | 'conectar' | 'probar'
  titulo: string
  detalle: string
  estado: EstadoPaso
}

export type EntradaPasos = {
  calendario: Pick<Lanzamiento, 'estado'>[]
  activo: Pick<Lanzamiento, 'label'> | null
  /** null = no se pudo leer el estado del secreto: no se da por configurado ni por ausente. */
  secretoConfigurado: boolean | null
  /** Fecha de la última entrega VÁLIDA recibida, con evidencia en raw_events. */
  ultimoEvento: string | null
  /** Apuntados al lanzamiento activo. */
  leads: number
}

/**
 * Los cuatro pasos para que un lanzamiento reciba leads, cada uno con su estado real. Solo el primer
 * paso sin hacer queda como "ahora": la pantalla enseña UNA cosa que hacer, no cuatro a la vez.
 */
export function pasosActivacion(e: EntradaPasos): PasoActivacion[] {
  const hayFecha = e.calendario.length > 0
  const hecho = {
    programar: hayFecha,
    abrir: Boolean(e.activo),
    conectar: e.secretoConfigurado === true,
    // Un lead apuntado solo puede haber entrado por el webhook: también prueba la conexión.
    probar: Boolean(e.ultimoEvento) || e.leads > 0,
  }
  const pasos: Omit<PasoActivacion, 'estado'>[] = [
    {
      id: 'programar',
      titulo: 'Programa la fecha del evento',
      detalle: hecho.programar
        ? 'Ya hay fechas en el calendario.'
        : 'Elige el día del evento y ponle un nombre. Programar no activa nada todavía.',
    },
    {
      id: 'abrir',
      titulo: 'Abre el lanzamiento',
      detalle: e.activo
        ? `${e.activo.label} está abierto: los leads nuevos se apuntan a él.`
        : 'Hasta que no lo abres, los leads que mande GHL no tienen a dónde apuntarse y se descartan.',
    },
    {
      id: 'conectar',
      titulo: 'Conecta GHL',
      detalle: hecho.conectar
        ? 'El secreto del webhook está guardado en esta subcuenta.'
        : e.secretoConfigurado === null
          ? 'No se pudo comprobar si el secreto está guardado. Revísalo en Integraciones.'
          : 'Guarda el secreto en Integraciones y crea en GHL un Custom Webhook por cada dirección de abajo.',
    },
    {
      id: 'probar',
      titulo: 'Haz una prueba',
      detalle: hecho.probar
        ? 'Ya ha llegado al menos un evento de GHL.'
        : 'Regístrate tú con tu email en el formulario del evento: debe aparecer aquí en unos segundos.',
    },
  ]
  let yaHayAhora = false
  return pasos.map((p) => {
    if (hecho[p.id]) return { ...p, estado: 'hecho' as const }
    if (yaHayAhora) return { ...p, estado: 'pendiente' as const }
    yaHayAhora = true
    return { ...p, estado: 'ahora' as const }
  })
}

export function activacionCompleta(pasos: PasoActivacion[]): boolean {
  return pasos.every((p) => p.estado === 'hecho')
}
