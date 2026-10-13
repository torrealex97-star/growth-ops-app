import type { SupabaseClient } from '@supabase/supabase-js'
import { resolverCampanaPorUtm, type CampanaCatalogo } from '@/lib/contacts/resolver-campana'

/**
 * BACKFILL DE campaign_id POR CONTACTO desde la primera ATribuCIÓN con utm_campaign.
 *
 * DÓNDE APLICAMOS EL ALIASING: cuando `contact_attributions.utm_campaign` ya está normalizado
 * (la misma normalización vive en el resolver), solo hay que casar el nombre y escribir el id.
 * Con esto la pantalla por campaña y el funnel distinguen ya de qué campaña concreta de Meta
 * vino cada lead — y no solo por fuente genérica ('facebook', 'IG').
 *
 * SEMÁNTICA (mismo espíritu que `backfillAtribucionLocal`):
 *   · SOLO contactos con `campaign_id IS NULL` — un campaign_id ya puesto no se toca (el admin
 *     que lo asignó a mano manda).
 *   · El toque es la primera atribución del contacto con utm_campaign, no la última: el canal
 *     que CAPTÓ es el que dice de dónde vino.
 *   · Orgánicas quedan sin campaign_id (fila NULL para siempre, no es un hueco que arreglar).
 *   · Ambiguas y sin match se DEVUELVEN para revisión, sin escribir nada.
 *   · IDEMPOTENTE: correrlo dos veces no cambia nada (segunda pasada no encuentra huecos).
 */
export async function backfillCampaignId(
  sb: SupabaseClient,
  tenantId: string,
  opts: { limite?: number } = {}
): Promise<{
  contactosConsiderados: number
  asignados: number
  organicas: number
  sinMatch: number
  ambiguas: number
  ejemplos: Record<string, unknown>[]
  errores: string[]
}> {
  const limite = Math.max(1, Math.min(opts.limite ?? 500, 2000))

  // Catálogo de campañas sincronizadas de la subcuenta (Meta). `external_id` viaja SIEMPRE:
  // la regla de IDENTIDAD del resolver (utm_source = id de campaña) casaría por él y sin
  // la columna el fallback por nombre dejaría huérfanos los renames de Meta.
  const { data: camps, error: campsErr } = await sb
    .from('campaigns')
    .select('id, name, external_id')
    .eq('tenant_id', tenantId)
  if (campsErr) throw new Error(`No se pudo leer campaigns: ${campsErr.message}`)
  const catalogo: CampanaCatalogo[] = (camps ?? []) as CampanaCatalogo[]

  // Primera atribución con utm_campaign por contacto (UI en tenant: is_primary). Pendiente por
  // contacto elegimos el MÁS RECENTE con utm_campaign no-orgánico... no: el PRIMER utm_campaign
  // que el contacto mostró, y eso es `first_utm_campaign` — columnas hechas exactamente para esto.
  const { data: attrs, error: attrsErr } = await sb
    .from('contact_attributions')
    .select('contact_id, first_utm_campaign, utm_campaign, first_utm_source, utm_source')
    .eq('tenant_id', tenantId)
    .not('utm_campaign', 'is', null)
  if (attrsErr) throw new Error(`No se pudo leer contact_attributions: ${attrsErr.message}`)

  // El nombre de "primera atribución" es first_utm_campaign si existe, y si no utm_campaign
  // (toque único). Fuente de verdad: lo que el proveedor reportó como primer toque.
  // La IDENTIDAD también viaja: first_utm_source puede ser el id de campaña de Meta
  // (regla 0 del resolver — manda sobre el nombre, no muere con un rename en Meta).
  const porContacto = new Map<string, { utm: string | null; utmSource: string | null }>()
  for (const a of attrs ?? []) {
    const r = a as {
      contact_id: string
      first_utm_campaign: string | null
      utm_campaign: string | null
      first_utm_source: string | null
      utm_source: string | null
    }
    if (!r.contact_id || porContacto.has(r.contact_id)) continue
    porContacto.set(r.contact_id, {
      utm: r.first_utm_campaign ?? r.utm_campaign,
      utmSource: r.first_utm_source ?? r.utm_source,
    })
  }

  // Contactos con campaña ya asignada NO se tocan. Organicas no cuentan como hueco.
  const { data: conId, error: conIdErr } = await sb
    .from('contacts')
    .select('id')
    .eq('tenant_id', tenantId)
    .not('campaign_id', 'is', null)
  if (conIdErr) throw new Error(`No se pudo leer contacts: ${conIdErr.message}`)
  const yaAsignados = new Set((conId ?? []).map((c) => (c as { id: string }).id))

  const objetivos = [...porContacto.entries()].filter(([cid]) => !yaAsignados.has(cid)).slice(0, limite)

  let asignados = 0
  let organicas = 0
  let sinMatch = 0
  let ambiguas = 0
  const ejemplos: Record<string, unknown>[] = []
  const errores: string[] = []

  // UPDATE por id: son pocas filas (límite bajo), y un update por lote con ids variados exigiría
  // rpc/SQL a medida. Una sola escritura por contacto objetivo, idempotente por la guard de arriba.
  for (const [contactId, ident] of objetivos) {
    const res = resolverCampanaPorUtm(ident.utm, catalogo, { utmSource: ident.utmSource })
    if (res.kind === 'directa') {
      const { error } = await sb
        .from('contacts')
        .update({ campaign_id: res.campaignId })
        .eq('id', contactId)
        .eq('tenant_id', tenantId)
        .is('campaign_id', null)
      if (error) errores.push(`${contactId}: ${error.message}`)
      else asignados++
    } else if (res.kind === 'organica') {
      organicas++
    } else if (res.kind === 'ambigua') {
      ambiguas++
      if (ejemplos.length < 10)
        ejemplos.push({ utm: ident.utm, utm_source: ident.utmSource, kind: 'ambigua', candidates: res.candidates })
    } else {
      // sin_campaign: ni el id ni el nombre existen todavía en campaigns (campaña de otra
      // cuenta, borrada, o nuevos nombres pendientes de sync). Devuelve lo que llegó para
      // revisión, no inventa.
      sinMatch++
      if (ejemplos.length < 10) ejemplos.push({ utm: ident.utm, utm_source: ident.utmSource, kind: 'sin_campaign' })
    }
  }

  return {
    contactosConsiderados: objetivos.length,
    asignados,
    organicas,
    sinMatch,
    ambiguas,
    ejemplos,
    errores: errores.slice(0, 20),
  }
}
