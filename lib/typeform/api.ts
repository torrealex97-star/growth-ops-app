// Cliente mínimo de la API de Typeform (solo lectura) para cargar el HISTÓRICO de respuestas.
//
// El webhook solo trae lo que ocurre DESPUÉS de crearlo: quien rellenó el formulario antes (o en un
// formulario sin webhook) llega a la agenda sin sus respuestas. Esto lee esas respuestas con un token
// personal (scopes forms:read + responses:read) y las entrega con la MISMA forma que el webhook
// (`form_response` con `definition`) para pasar por el mismo motor.
//
// Las cuentas del centro de datos europeo se sirven desde api.eu.typeform.com.

export const TYPEFORM_PAGINA = 100

type Json = Record<string, unknown>
const esObjeto = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

export type ClienteTypeform = {
  listarFormularios(): Promise<{ id: string; titulo: string }[]>
  leerDefinicion(formId: string): Promise<Json>
  /** Respuestas COMPLETADAS, de la más reciente a la más antigua. `antesDe` = token de la última leída. */
  leerRespuestas(
    formId: string,
    opciones: { desde?: string; antesDe?: string; tamano?: number }
  ): Promise<{ items: Json[]; total: number }>
}

export function baseTypeform(region: string | undefined | null): string {
  return /^eu$/i.test((region ?? '').trim()) ? 'https://api.eu.typeform.com' : 'https://api.typeform.com'
}

export function crearClienteTypeform(
  token: string,
  opciones: { region?: string | null; fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): ClienteTypeform {
  const base = baseTypeform(opciones.region)
  const f = opciones.fetchImpl ?? fetch
  const timeoutMs = opciones.timeoutMs ?? 15_000

  async function get(ruta: string, query: Record<string, string> = {}): Promise<Json> {
    const qs = new URLSearchParams(query).toString()
    const res = await f(`${base}${ruta}${qs ? `?${qs}` : ''}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        'Typeform rechazó el token (401/403). Revisa que sea un token personal con permisos forms:read y responses:read, y la región (EU) de tu cuenta.'
      )
    }
    if (res.status === 404) throw new Error(`Typeform no encuentra ${ruta}`)
    if (!res.ok) throw new Error(`Typeform respondió ${res.status} en ${ruta}`)
    const cuerpo = (await res.json().catch(() => null)) as unknown
    if (!esObjeto(cuerpo)) throw new Error(`Typeform devolvió una respuesta ilegible en ${ruta}`)
    return cuerpo
  }

  return {
    async listarFormularios() {
      const salida: { id: string; titulo: string }[] = []
      for (let pagina = 1; pagina <= 20; pagina++) {
        const j = await get('/forms', { page_size: '200', page: String(pagina) })
        const items = Array.isArray(j.items) ? j.items.filter(esObjeto) : []
        for (const it of items) {
          if (typeof it.id === 'string')
            salida.push({ id: it.id, titulo: typeof it.title === 'string' ? it.title : it.id })
        }
        if (pagina >= Number(j.page_count ?? 1) || items.length === 0) break
      }
      // Orden estable: el cursor del histórico recorre los formularios por id.
      return salida.sort((a, b) => a.id.localeCompare(b.id))
    },
    leerDefinicion(formId) {
      return get(`/forms/${encodeURIComponent(formId)}`)
    },
    async leerRespuestas(formId, { desde, antesDe, tamano }) {
      const q: Record<string, string> = {
        page_size: String(Math.min(tamano ?? TYPEFORM_PAGINA, 1000)),
        completed: 'true',
        sort: 'submitted_at,desc',
      }
      if (desde) q.since = desde
      if (antesDe) q.before = antesDe
      const j = await get(`/forms/${encodeURIComponent(formId)}/responses`, q)
      return { items: Array.isArray(j.items) ? j.items.filter(esObjeto) : [], total: Number(j.total_items ?? 0) }
    },
  }
}

/** Envuelve una respuesta de la API con la forma del webhook, para que la lea el mismo normalizador. */
export function comoPayloadDeWebhook(item: Json, formId: string, definicion: Json): Json {
  return {
    event_id: typeof item.token === 'string' ? item.token : undefined,
    event_type: 'form_response',
    form_response: { ...item, form_id: formId, definition: definicion },
  }
}
