// Diagnóstico de lo que el token de GoHighLevel PUEDE hacer en esta subcuenta. Solo lecturas: no
// escribe nada. Existe porque los permisos (scopes) de un token se fijan al crearlo y la API no los
// lista; la única forma fiable de saberlos es probar cada área. El resultado alimenta la prueba de
// conexión de Integraciones y decide qué funciones se pueden ofrecer (bandeja, publicar en redes…).

const BASE = 'https://services.leadconnectorhq.com'
const VERSION = '2021-07-28'

export type EstadoCapacidad = 'ok' | 'sin_permiso' | 'no_disponible' | 'error'

export type Capacidad = {
  id: 'contactos' | 'calendarios' | 'conversaciones' | 'oportunidades' | 'redes_sociales'
  etiqueta: string
  estado: EstadoCapacidad
  /** Dato útil y no sensible (p. ej. las redes conectadas). */
  detalle?: string
}

type Sonda = {
  id: Capacidad['id']
  etiqueta: string
  ruta: (loc: string) => string
  /** Resume una respuesta correcta en una frase corta, sin datos personales. */
  resumir?: (json: Record<string, unknown>) => string | undefined
}

const SONDAS: Sonda[] = [
  { id: 'contactos', etiqueta: 'Contactos', ruta: (l) => `/contacts/?locationId=${l}&limit=1` },
  { id: 'calendarios', etiqueta: 'Calendarios', ruta: (l) => `/calendars/?locationId=${l}` },
  { id: 'conversaciones', etiqueta: 'Conversaciones', ruta: (l) => `/conversations/search?locationId=${l}&limit=1` },
  { id: 'oportunidades', etiqueta: 'Oportunidades', ruta: (l) => `/opportunities/pipelines?locationId=${l}` },
  {
    id: 'redes_sociales',
    etiqueta: 'Redes sociales (Social Planner)',
    ruta: (l) => `/social-media-posting/${l}/accounts`,
    resumir: redesConectadas,
  },
]

/** Plataformas conectadas (solo el nombre de la red, nunca cuentas ni identificadores). */
export function redesConectadas(json: Record<string, unknown>): string | undefined {
  const results = (json.results ?? json) as Record<string, unknown> | undefined
  const cuentas = (results?.accounts ?? (results as { data?: unknown })?.data ?? []) as unknown
  if (!Array.isArray(cuentas)) return undefined
  const redes = new Set<string>()
  for (const c of cuentas) {
    const p = (c as { platform?: unknown })?.platform
    if (typeof p === 'string' && p.trim()) redes.add(p.trim().toLowerCase())
  }
  return redes.size ? [...redes].sort().join(', ') : 'ninguna red conectada'
}

export function estadoDeHttp(status: number): EstadoCapacidad {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 401 || status === 403) return 'sin_permiso'
  if (status === 404 || status === 422) return 'no_disponible'
  return 'error'
}

export async function diagnosticarGhl(p: {
  token: string
  locationId: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<Capacidad[]> {
  const f = p.fetchImpl ?? fetch
  const loc = encodeURIComponent(p.locationId)
  return Promise.all(
    SONDAS.map(async (s): Promise<Capacidad> => {
      try {
        const r = await f(`${BASE}${s.ruta(loc)}`, {
          headers: { Authorization: `Bearer ${p.token}`, Version: VERSION, Accept: 'application/json' },
          signal: AbortSignal.timeout(p.timeoutMs ?? 8000),
        })
        const estado = estadoDeHttp(r.status)
        let detalle: string | undefined
        if (estado === 'ok' && s.resumir) {
          detalle = s.resumir((await r.json().catch(() => ({}))) as Record<string, unknown>)
        }
        return { id: s.id, etiqueta: s.etiqueta, estado, detalle }
      } catch {
        return { id: s.id, etiqueta: s.etiqueta, estado: 'error' }
      }
    })
  )
}

/** Frase para la prueba de conexión: qué funciona y qué permiso falta. */
export function resumenDiagnostico(caps: Capacidad[]): string {
  const ok = caps.filter((c) => c.estado === 'ok')
  const falta = caps.filter((c) => c.estado !== 'ok')
  const redes = caps.find((c) => c.id === 'redes_sociales')
  const partes = [`Permisos verificados: ${ok.length ? ok.map((c) => c.etiqueta).join(', ') : 'ninguno'}.`]
  if (redes?.estado === 'ok') partes.push(`Redes conectadas en GHL: ${redes.detalle}.`)
  if (falta.length) {
    partes.push(
      `Sin acceso o sin comprobar: ${falta.map((c) => `${c.etiqueta} (${c.estado.replace('_', ' ')})`).join(', ')}. ` +
        'Si los necesitas, añade esos permisos al token en GHL → Ajustes → Integraciones privadas.'
    )
  }
  return partes.join(' ')
}
