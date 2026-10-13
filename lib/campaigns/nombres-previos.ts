import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarUtmCampaign } from '@/lib/contacts/resolver-campana'

// NOMBRES PREVIOS DE UNA CAMPAÑA, derivados de los utm históricos de los contactos.
//
// EL CASO (comprobado en producción): Meta renombró «COLD AUDIENCE - Copia» a
// «🟢 AGENDA | COLD LOOKALIKE AUDIENCE» y el nombre del anuncio que los leads trajeron
// en su utm_campaign quedó congelado en el momento del toque. La ficha de campaña muestra
// solo el nombre ACTUAL (campaigns.name del sync), así que el rename es invisible y parece
// que los leads «sin nombre» no vienen de esta campaña cuando sí vienen (la regla de
// identidad por external_id los asigna).
//
// CÓMO SE DETECTA, sin inventar nada: los contactos que el resolver asignó a esta campaña
// (contacts.campaign_id) trajeron en su PRIMER toque un utm_campaign crudo. Si ese crudo
// normalizado NO coincide con el nombre actual pero SÍ apunta a un solo id de campaña de
// Meta o es un nombre distinto del actual, es un NOMBRE PREVIO real: cómo se llamaba la
// campaña (o cómo la codificó el proveedor) cuando esos leads la tocaron.
//
// Qué NO es un nombre previo (no se avisa de esto, para no metrificar ruido):
//   · Codificación del proveedor que normalizamos solos: '+' de Calendly por espacios,
//     mayúsculas/espacios redundantes (normalizarUtmCampaign los iguala).
//   · utm vacío u orgánico (igualarían a string vacío tras normalizar).
//
// El origen es SOLO LECTURA: no persiste ni muta campaigns; cuando el historial cambie,
// el badge se recalcula. Proyección mínima (presupuesto de payload): nunca traemos
// raw_payload ni atribuciones completas de contacto.
export type CampañaNombresPrevios = {
  /** campaign.id en la base local. */
  campaignId: string
  /** Nombres crudos del primer toque de los contactos asignados a esta campaña, únicos, sin el actual. */
  previos: string[]
  /** Cuántos contactos aportaron cada nombre previo (evidencia, no decisión). */
  conteo: Record<string, number>
}

/** El nombre con el que el proveedor codifica SIN espacios ni alias de caso coincide con el actual. */
export function esNombrePrevioReal(utmCrudo: string | null | undefined, nombreActual: string): boolean {
  const crudo = normalizarUtmCampaign(utmCrudo)
  if (!crudo) return false
  return crudo !== normalizarUtmCampaign(nombreActual)
}

/**
 * Para CADA campaña de la subcuenta, qué nombres previos se conocen por los utm históricos
 * de los contactos ya asignados a ella. La atribución vive en `contact_attributions`; el
 * `campaign_id` vive en `contacts`. Se leen mediante su FK, con tenant scope en ambas tablas,
 * proyección mínima y paginación para no truncar tenants grandes.
 */
export async function nombresPreviosPorCampana(
  sb: SupabaseClient,
  tenantId: string
): Promise<Record<string, CampañaNombresPrevios>> {
  // Catálogo: nombre actual por campaña.
  const { data: camps, error: campsErr } = await sb.from('campaigns').select('id, name').eq('tenant_id', tenantId)
  if (campsErr) throw new Error(`No se pudo leer campaigns: ${campsErr.message}`)

  const nombreActual = new Map<string, string>()
  for (const c of (camps ?? []) as { id: string; name: string }[]) {
    nombreActual.set(c.id, c.name)
  }
  if (nombreActual.size === 0) return {}

  type AttributionRow = {
    contact_id: string
    first_utm_campaign: string | null
    utm_campaign: string | null
    contacts: { campaign_id: string | null; tenant_id: string | null } | null
  }
  const attributions: AttributionRow[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from('contact_attributions')
      .select('contact_id, first_utm_campaign, utm_campaign, contacts!inner(campaign_id, tenant_id)')
      .eq('tenant_id', tenantId)
      .eq('contacts.tenant_id', tenantId)
      .not('contacts.campaign_id', 'is', null)
      .or('first_utm_campaign.not.is.null,utm_campaign.not.is.null')
      .order('id')
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`No se pudo leer contact_attributions: ${error.message}`)
    const rows = (data ?? []) as unknown as AttributionRow[]
    attributions.push(...rows)
    if (rows.length < pageSize) break
  }

  const porCampana = new Map<string, Map<string, number>>()
  for (const r of attributions) {
    const campaignId = r.contacts?.campaign_id
    const utmCampaign = r.first_utm_campaign ?? r.utm_campaign
    if (!campaignId || !utmCampaign) continue
    const actual = nombreActual.get(campaignId)
    if (actual === undefined) continue // campaña ya no existe: no mostramos previos huérfanos
    if (!esNombrePrevioReal(utmCampaign, actual)) continue // mismo nombre (o ruido proveedor): no es rename
    const bucket = porCampana.get(campaignId) ?? new Map<string, number>()
    bucket.set(utmCampaign, (bucket.get(utmCampaign) ?? 0) + 1)
    porCampana.set(campaignId, bucket)
  }

  // Formato final: nombres únicos por campaña, ordenados por evidencia (desc) y alfabético.
  const salida: Record<string, CampañaNombresPrevios> = {}
  for (const [campaignId, bucket] of porCampana) {
    const previos = Array.from(bucket.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name)
    const conteo: Record<string, number> = {}
    for (const [name, n] of bucket) conteo[name] = n
    salida[campaignId] = { campaignId, previos, conteo }
  }
  return salida
}

/** Nombre corto de UI: 'renombrada'. Vacío si no hay previos (no hay badge). */
export function esRenombrada(previos: string[] | undefined): previos is string[] {
  return Array.isArray(previos) && previos.length > 0
}
