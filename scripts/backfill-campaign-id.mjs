// CORREDOR DEL BACKFILL DE campaign_id — invoca la función canónica
// `backfillCampaignId` (lib/contacts/backfill-campaign-id.ts) por cada subcuenta activa.
//
// IMPORTANTE: ESCRIBE en producción. La función canónica es idempotente y conservadora:
//   · SOLO escribe matches 'directa' (identidad por utm_source = id de Meta, o nombre exacto
//     normalizado). Orgánicas no se toca; ambiguas y sin match NO se escriben (se listan).
//   · El UPDATE lleva guard `.is('campaign_id', null)`: un campaign_id ya asignado (a mano)
//     nunca se sobreescribe. Correrlo dos veces no cambia nada.
//
// Salida: hueco antes → resultado del backfill → hueco después (verificación).
// No imprime PII: los ejemplos son nombres de campaña/UTM, nunca emails ni teléfonos.
//
// Uso:  node --import ./tests/register.mjs scripts/backfill-campaign-id.mjs [slug]

import { register } from 'node:module'

// Reutiliza el mismo loader de alias '@/' que la suite, para importar el módulo canónico.
register('./alias-loader.mjs', new URL('../tests/register.mjs', import.meta.url))

const { createClient } = await import('@supabase/supabase-js')
const { leerEnvLocal } = await import('./env-local.mjs')
const { backfillCampaignId } = await import('@/lib/contacts/backfill-campaign-id')

const slugFiltro = process.argv.slice(2).filter((a) => !a.startsWith('--'))[0] ?? null

const env = leerEnvLocal()
const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '')
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local')
  process.exit(1)
}
const sb = createClient(url, key)

// Hueco medido sobre la MISMA definición que el diagnóstico: contactos con una atribución que trae
// utm_campaign y sin contacts.campaign_id. Organicas incluidas (el backfill las separa sin escribir).
async function hueco(tenantId) {
  const { data: conUtm, error: e1 } = await sb
    .from('contact_attributions')
    .select('contact_id')
    .eq('tenant_id', tenantId)
    .not('utm_campaign', 'is', null)
  if (e1) throw new Error(`contact_attributions: ${e1.message}`)
  const ids = [...new Set((conUtm ?? []).map((r) => String(r.contact_id)).filter(Boolean))]

  const { data: conId, error: e2 } = await sb
    .from('contacts')
    .select('id')
    .eq('tenant_id', tenantId)
    .not('campaign_id', 'is', null)
  if (e2) throw new Error(`contacts: ${e2.message}`)
  const ya = new Set((conId ?? []).map((c) => String(c.id)))

  const huecos = ids.filter((id) => !ya.has(id))
  return { conUtm: ids.length, conId: ya.size, huecos: huecos.length }
}

const q = sb.from('tenants').select('id, slug, name').eq('status', 'active').order('name')
const { data: tenants, error: tErr } = slugFiltro ? await q.eq('slug', slugFiltro) : await q
if (tErr) throw new Error(`tenants: ${tErr.message}`)

console.log(`Subcuentas activas: ${tenants.length}${slugFiltro ? ` (filtro slug=${slugFiltro})` : ''}`)
console.log('MODALIDAD: ESCRITURA (backfill canónico, idempotente, solo matches directas)')

for (const t of tenants) {
  console.log(`\n[${t.slug}]`)
  const antes = await hueco(t.id)
  console.log(
    `  Hueco antes: ${antes.huecos} contactos con utm_campaign sin campaign_id (de ${antes.conUtm} con UTM; ${antes.conId} ya con campaña)`
  )

  const res = await backfillCampaignId(sb, t.id, { limite: 2000 })
  console.log(
    `  Backfill (${res.contactosConsiderados} considerados): directas=${res.asignados} organicas=${res.organicas} sinMatch=${res.sinMatch} ambiguas=${res.ambiguas} errores=${res.errores.length}`
  )
  for (const ejemplo of res.ejemplos) console.log(`    ejemplo: ${JSON.stringify(ejemplo)}`)
  for (const err of res.errores) console.log(`    ERROR: ${err}`)

  const despues = await hueco(t.id)
  console.log(
    `  Hueco después: ${despues.huecos} (resto = orgánicas + sin match + ambiguas: cola de revisión, no se inventan)`
  )
}

console.log('\nBackfill terminado (escrito).')
