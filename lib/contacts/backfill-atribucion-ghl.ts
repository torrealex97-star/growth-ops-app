import type { SupabaseClient } from '@supabase/supabase-js'
import { leerToque, registrarToque, toqueTieneDatos, type ToqueAtribucion } from '@/lib/contacts/atribucion'

type Json = Record<string, unknown>

/**
 * BACKFILL DE ATRIBUCIÓN DESDE LA FICHA DE GHL (una llamada GET por contacto hueco).
 *
 * EL CASO REAL (medido en producción, 23-oct): las ventas cerradas no se atribuyen a campaña de
 * Meta porque los COMPRADORES no llevan atribución en ninguna fuente de la app. Los payloads de
 * Stripe no traen UTM alguna y Hotmart/Whop no han entregado eventos; GHL, en cambio, SÍ conserva
 * en la ficha del contacto la atribución del lead (first/last attribution con `utmSource`,
 * `adId`, `adName`, `adSetId`) — es lo mismo que ya entregan sus webhooks.
 *
 * QUÉ HACE: para cada contacto con `ghl_contact_id` cuya atribución primaria no tiene evidencia
 * de campaña (`utm_source` y `utm_campaign` vacíos), lee SU FICHA en GHL y registra los toques
 * con EXACTAMENTE la semántica de `registrarToque`: rellena `first_utm_*` solo si estaba vacío,
 * nunca sobrescribe un origen existente, y los toques antiguos no se presentan como últimos.
 *
 * POR QUÉ NO EL ARRAY `attributions[]`: su orden (¿el elemento 0 es el primer toque o el más
 * reciente?) NO está documentado en la API de HighLevel (comprobado en docs y fuentes públicas,
 * 23-oct). En cambio, la ficha y los webhooks exponen los toques en campos separados con
 * semántica declarada por el propio GHL — First Attribution / Latest Attribution —, y esos son
 * los que se leen. Fabricar un «primer toque» con un elemento de orden desconocido podría
 * atribuir a una campaña el mérito de otra: eso no se adivina, se ignora.
 */

/**
 * Toques en orden cronológico según la semántica que el propio GHL declara por campo:
 * first → (second) → last. `attributionSource` es la forma que usan sus webhooks para el
 * primer toque; la ficha a veces lo trae como `firstAttributionSource`. Cada toque se lee con
 * `leerToque` (mismas rutas que el webhook) y se descarta si no aporta nada.
 */
export function toquesDesdeFichaGhl(contacto: Json): ToqueAtribucion[] {
  const toques: ToqueAtribucion[] = []
  for (const clave of [
    'firstAttributionSource',
    'attributionSource',
    'secondAttributionSource',
    'lastAttributionSource',
  ]) {
    const obj = contacto?.[clave]
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue
    const toque = leerToque(obj)
    toque.evidenceSource = clave === 'lastAttributionSource' ? 'provider_last' : 'provider_first'
    if (toqueTieneDatos(toque)) toques.push(toque)
  }
  return toques
}

/** Hueco de atribución: sin identidad de campaña en ninguna de las dos columnas de campaña. */
export function sinEvidenciaCampana(fila: { utm_source: string | null; utm_campaign: string | null }): boolean {
  return !fila.utm_source && !fila.utm_campaign
}

export type ResultadoBackfillAtribucionGhl = {
  contactosConsiderados: number
  contactosConNuevosDatos: number
  toquesRegistrados: number
  sinDatosGhl: number
  cortado: boolean
  errores: string[]
}

export async function backfillAtribucionGhl(
  sb: SupabaseClient,
  tenantId: string,
  opts: {
    token: string
    locationId: string
    limite?: number
    deadlineMs?: number
    fetcher?: typeof fetch
  }
): Promise<ResultadoBackfillAtribucionGhl> {
  const limite = Math.max(1, Math.min(opts.limite ?? 400, 2_000))
  const deadlineMs = opts.deadlineMs ?? Date.now() + 45_000
  const fetcher = opts.fetcher ?? fetch
  const errores: string[] = []

  // 1) Contactos que YA tienen evidencia de campaña en su atribución primaria: no se tocan
  //    (first-wins manda; releerlos solo gastaría cuota de GHL).
  const conCampana = new Set<string>()
  {
    let desde = 0
    for (;;) {
      const { data, error } = await sb
        .from('contact_attributions')
        .select('contact_id, utm_source, utm_campaign')
        .eq('tenant_id', tenantId)
        .eq('is_primary', true)
        .range(desde, desde + 999)
      if (error) throw new Error(`No se pudo leer contact_attributions: ${error.message}`)
      for (const a of data ?? []) {
        const r = a as { contact_id: string; utm_source: string | null; utm_campaign: string | null }
        if (!sinEvidenciaCampana(r)) conCampana.add(r.contact_id)
      }
      if ((data ?? []).length < 1000) break
      desde += 1000
    }
  }

  // 2) Objetivos: contactos con ficha GHL cuyo toque primario no tiene evidencia de campaña.
  //    Los COMPRADORES van primero: es la cohorte que deja la venta sin atribuir, y un corte
  //    por presupuesto no debe dejar fuera al que mueve el dinero.
  const objetivos: Array<{ id: string; ghl_contact_id: string; esComprador: boolean }> = []
  {
    let desde = 0
    for (;;) {
      const { data, error } = await sb
        .from('contacts')
        .select('id, ghl_contact_id, lead_status')
        .eq('tenant_id', tenantId)
        .not('ghl_contact_id', 'is', null)
        .range(desde, desde + 999)
      if (error) throw new Error(`No se pudo leer contacts: ${error.message}`)
      for (const c of data ?? []) {
        const r = c as { id: string; ghl_contact_id: string; lead_status: string | null }
        if (conCampana.has(r.id)) continue
        objetivos.push({ id: r.id, ghl_contact_id: r.ghl_contact_id, esComprador: r.lead_status === 'venta' })
      }
      if ((data ?? []).length < 1000) break
      desde += 1000
    }
  }
  objetivos.sort((a, b) => Number(b.esComprador) - Number(a.esComprador))
  const lote = objetivos.slice(0, limite)

  const headers = { Authorization: `Bearer ${opts.token}`, Version: '2021-07-28', Accept: 'application/json' }
  let contactosConsiderados = 0
  let contactosConNuevosDatos = 0
  let toquesRegistrados = 0
  let sinDatosGhl = 0
  let cortado = false

  for (const objetivo of lote) {
    // El deadline gobierna TODAS las llamadas externas: se mira el reloj ANTES de cada GET, no
    // solo al inicio. Lo no procesado lo trae la siguiente pasada (idempotente: los huecos
    // recogidos ya no reaparecen).
    if (Date.now() > deadlineMs) {
      cortado = true
      break
    }
    contactosConsiderados++
    let ficha: Json | null = null
    try {
      const res = await fetcher(
        `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(objetivo.ghl_contact_id)}`,
        { headers, signal: AbortSignal.timeout(10_000) }
      )
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { contact?: Json }
        ficha = body.contact ?? null
      } else {
        errores.push(`${objetivo.id}: GHL respondió ${res.status}`)
      }
    } catch (e) {
      errores.push(`${objetivo.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (!ficha) continue

    let toques = 0
    let falloEscritura = false
    for (const toque of toquesDesdeFichaGhl(ficha)) {
      const r = await registrarToque(sb, tenantId, objetivo.id, toque)
      if (!r.ok) {
        errores.push(`${objetivo.id}: ${r.error}`)
        falloEscritura = true
        break
      }
      if (r.accion !== 'sin_datos') toques++
    }
    if (falloEscritura) continue
    // Con toques registrados el contacto sale del hueco; sin ellos, GHL tampoco tiene nada que
    // aportar (un hueco no es un cero: no se inventa origen) y la siguiente pasada lo salta
    // porque vuelve a estar en el hueco... no: sigue en el hueco y se relee. Cota natural: solo
    // se relee mientras el límite/presupuesto lo permita y el operador lo lance de nuevo.
    if (toques > 0) {
      contactosConNuevosDatos++
      toquesRegistrados += toques
    } else {
      sinDatosGhl++
    }
  }

  return {
    contactosConsiderados,
    contactosConNuevosDatos,
    toquesRegistrados,
    sinDatosGhl,
    cortado,
    errores: errores.slice(0, 20),
  }
}
