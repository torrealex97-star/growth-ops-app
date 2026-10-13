// RESOLVER DE CAMPAÑA POR utm_campaign (aliasing declarativo).
//
// EL PROBLEMA REAL (comprobado en producción): contact_attributions guarda el utm_campaign TAL
// CUAL lo trajo el proveedor, y contacts.campaign_id llevaba semanas a 0 — ninguna pantalla por
// campaña puede distinguir de qué campaña de Meta vino cada lead. Los nombres NO casan tal cual:
// Calendly codifica los espacios como '+' (`🟢+AGENDA+|+COLD+LOOKALIKE+AUDIENCE`) y la base de
// campañas sincronizadas de Meta guarda el nombre real (`🟢 AGENDA | COLD LOOKALIKE AUDIENCE`).
//
// LAS REGLAS — declarativas, sin IA ni fuzzy matching mágico:
//   1. Normalización verificable: '+' → espacio, colapsar espacios, minúsculas.
//   2. Match EXACTO sobre el nombre normalizado. Una campaña "copia" (`- Copia`) es OTRA campaña:
//      duplicar el nombre de un anuncio no las funde — el gasto y las métricas son distintas.
//   3. Orgánico NO es campaña de ads: 'organic', 'facebook_organic' y 'direct' quedan sin
//      campaign_id. Es un hueco honesto ("sin campaña pagada"), no un falso match.
//   4. AMBIGUO: si la normalización deja DOS campañas con el mismo nombre (con external_id
//      distinto), devolvemos `{ ok: false, kind: 'ambigua' }` — y el llamador lo va a la cola
//      de revisión; es la regla "ante la duda, no decidas" (lib/fathom/match.ts).
//
// El resolver es PURO: recibe el catálogo ya traído y no sabe nada de base. Testeable sin BD.

export type CampanaCatalogo = { id: string; name: string; external_id?: string | null }

export type ResultadoCampana =
  | { ok: true; kind: 'directa'; campaignId: string }
  | { ok: true; kind: 'organica' }
  | { ok: true; kind: 'sin_campaign' }
  | { ok: false; kind: 'ambigua'; candidates: string[] }

/**
 * ¿Pinta esto de ser un id de campaña de Meta? Los external_id de Meta son números de 15-18
 * dígitos (los del tenant real, 18: `120252786405750750`); los nombres de campañas reales nunca
 * son solo eso. Se usa para la regla de identidad de abajo.
 */
function esIdNumericoMeta(v: string): boolean {
  return /^1\d{14,17}$/.test(v)
}

/** Nombres de utm_campaign que significan "no vino de ads": campaña orgánica, no una de Meta. */
const ORGANICAS = new Set(['organic', 'facebook_organic', 'instagram_organic', 'direct', 'bio'])

export function normalizarUtmCampaign(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
}

export function resolverCampanaPorUtm(
  utmCampaign: string | null | undefined,
  catalogo: CampanaCatalogo[],
  identidad?: { utmSource?: string | null }
): ResultadoCampana {
  // ── REGLA 0: la IDENTIDAD manda sobre el NOMBRE ────────────────────────────
  // Meta reporta el id de la CAMPAÑA en utm_source y el id del adset en utm_term.
  // Si ese id está en el catálogo, esa ES la campaña — aunque el name haya cambiado
  // en Meta (una campaña renombrada deja huérfanos por nombre: el utm "- Copia"
  // de producción era en realidad COLD LOOKALIKE AUDIENCE renombrada). El nombre
  // solo se usa cuando llega un id desconocido (campaña de otra cuenta/borrada).
  const idCrudo = identidad?.utmSource?.trim() || ''
  if (esIdNumericoMeta(idCrudo)) {
    const porId = catalogo.filter((c) => c.external_id === idCrudo)
    if (porId.length === 1) return { ok: true, kind: 'directa', campaignId: porId[0].id }
    if (porId.length > 1) return { ok: false, kind: 'ambigua', candidates: porId.map((c) => c.id) }
    // id reconocible pero NO en catálogo → hueco honesto, igual que un nombre sin match.
    return { ok: true, kind: 'sin_campaign' }
  }

  const normalizado = normalizarUtmCampaign(utmCampaign)
  if (!normalizado) return { ok: true, kind: 'sin_campaign' }
  if (ORGANICAS.has(normalizado)) return { ok: true, kind: 'organica' }

  const ids = new Set<string>()
  const candidates: string[] = []
  for (const c of catalogo) {
    if (normalizarUtmCampaign(c.name) === normalizado) {
      ids.add(c.id)
      candidates.push(c.id)
    }
  }
  if (ids.size === 0) return { ok: true, kind: 'sin_campaign' }
  if (ids.size > 1) return { ok: false, kind: 'ambigua', candidates }
  return { ok: true, kind: 'directa', campaignId: ids.values().next().value as string }
}
