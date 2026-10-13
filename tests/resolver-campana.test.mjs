import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizarUtmCampaign, resolverCampanaPorUtm } from '../lib/contacts/resolver-campana.ts'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = (p) => readFileSync(join(raiz, p), 'utf8')

// Casos REALES de la subcuenta (comprobados en base): '+' como espacios, el duplicado legítimo
// "…- Copia" y los orgánicos que el proveedor mete como campaña.
const catalogo = [
  { id: 'meta-lookalike', name: '🟢 AGENDA | COLD LOOKALIKE AUDIENCE' },
  { id: 'meta-copia', name: '🟢 AGENDA | COLD AUDIENCE - Copia' },
  { id: 'meta-base', name: '🟢 AGENDA | COLD AUDIENCE' },
  { id: 'meta-trafico', name: '🟠 TRAFICO | ADVANTAGE | PERFIL CLAUDIA | MDL FUNNEL' },
]

test("la normalización traduce '+' (codificación de Calendly) a espacios y colapsa", () => {
  assert.equal(normalizarUtmCampaign('🟢+AGENDA+|+COLD+LOOKALIKE+AUDIENCE'), '🟢 agenda | cold lookalike audience')
  assert.equal(
    normalizarUtmCampaign(' 🟢 AGENDA   | Cold Lookalike Audience '),
    normalizarUtmCampaign('🟢 AGENDA | COLD LOOKALIKE AUDIENCE')
  )
})

test('match REAL: el utm de Calendly casos la campaña sincronizada de Meta', () => {
  const r = resolverCampanaPorUtm('🟢+AGENDA+|+COLD+LOOKALIKE+AUDIENCE', catalogo)
  assert.deepEqual(r, { ok: true, kind: 'directa', campaignId: 'meta-lookalike' })
  const t = resolverCampanaPorUtm('🟠 TRAFICO  | ADVANTAGE  | PERFIL CLAUDIA | MDL FUNNEL', catalogo)
  assert.equal(t.kind, 'directa')
})

test('el DUPLICADO legítimo "- Copia" es OTRA campaña: NO se funde con la base', () => {
  const r = resolverCampanaPorUtm('🟢+AGENDA+|+COLD+AUDIENCE+-+Copia', catalogo)
  assert.deepEqual(r, { ok: true, kind: 'directa', campaignId: 'meta-copia' })
})

test('orgánico NO es campaña de ads: no devuelve id', () => {
  for (const org of ['organic', 'facebook_organic', 'ORGANIC', 'Bio', 'direct']) {
    const r = resolverCampanaPorUtm(org, catalogo)
    assert.equal(r.kind, 'organica', `${org} debería salir organica`)
  }
})

test('nombre que no existe en el catálogo → sin_campaign (hueco declarado, no inventado)', () => {
  const r = resolverCampanaPorUtm('CAMPAÑA QUE YA NO EXISTE EN META', catalogo)
  assert.equal(r.kind, 'sin_campaign')
})

test('IDENTIDAD > nombre: utm_source con id de campaña manda aunque el name cambió (caso REAL "- Copia" = LOOKALIKE renombrada)', () => {
  // Producción 12-oct: utm_campaign '🟢+AGENDA+|+COLD+AUDIENCE+-+Copia' pero
  // first_utm_source = 120252786405750750 = external_id de '🟢 AGENDA | COLD LOOKALIKE AUDIENCE'.
  const catalogoSynConia = [
    { id: 'meta-lookalike', name: '🟢 AGENDA | COLD LOOKALIKE AUDIENCE', external_id: '120252786405750750' },
    { id: 'meta-base', name: '🟢 AGENDA | COLD AUDIENCE', external_id: '120252709396900750' },
  ]
  const r = resolverCampanaPorUtm('🟢+AGENDA+|+COLD+AUDIENCE+-+Copia', catalogoSynConia, {
    utmSource: '120252786405750750',
  })
  assert.deepEqual(r, { ok: true, kind: 'directa', campaignId: 'meta-lookalike' })
})

test('id numérico de utm_source NO presente en el catálogo → sin_campaign (identidad declarada, sin fantasma)', () => {
  const r = resolverCampanaPorUtm('CUALQUIER-NOMBRE', [{ id: 'x', name: 'X', external_id: '120299999999999999' }], {
    utmSource: '120211111111111111',
  })
  assert.equal(r.kind, 'sin_campaign')
})

test('utm_source NO numérico se ignora: el nombre manda como hasta ahora', () => {
  const r = resolverCampanaPorUtm(
    '🟢+AGENDA+|+COLD+LOOKALIKE+AUDIENCE',
    [{ id: 'meta-lookalike', name: '🟢 AGENDA | COLD LOOKALIKE AUDIENCE', external_id: '120252786405750750' }],
    { utmSource: 'facebook' }
  )
  assert.deepEqual(r, { ok: true, kind: 'directa', campaignId: 'meta-lookalike' })
})

test('dos campañas con el MISMO nombre normalizado → ambbiguia con candidates para revisión', () => {
  const r = resolverCampanaPorUtm('🟢 AGENDA | COLD AUDIENCE', [
    ...catalogo,
    { id: 'otra', name: '🟢+AGENDA+|+COLD+AUDIENCE' },
  ])
  assert.equal(r.ok, false)
  assert.equal(r.kind, 'ambigua')
  assert.ok(r.candidates.length >= 2)
})

test('guard del backfill: solo contactos con campaign_id NULL; el primero manda (first_utm_campaign)', () => {
  const src = leer('lib/contacts/backfill-campaign-id.ts')
  assert.match(src, /\.is\('campaign_id', null\)/, 'upsert con guard is-null: una carrera no pisa')
  assert.match(src, /first_utm_campaign \?\? r\.utm_campaign/, 'el PRIMER utm_campaign es el que decide')
  assert.match(src, /first_utm_source \?\? r\.utm_source/, 'la IDENTIDAD (utm_source= id de campaña) también viaja')
})

test('el backfill reutiliza el resolver y reporta sin_match/ambiguas sin escribir', () => {
  const src = leer('lib/contacts/backfill-campaign-id.ts')
  assert.match(src, /resolverCampanaPorUtm/, 'usa el resolver declarativo, no lógica ad-hoc')
  assert.match(src, /sinMatch\+\+/, 'cuenta sin match para revisión')
})

test("proveedor 'campañas' expuesto en history-sync vía recordSyncRun", () => {
  const route = leer('app/api/[tenant]/evergreen/settings/integraciones/history-sync/route.ts')
  assert.match(route, /body\.provider === 'campañas'/)
  assert.match(route, /backfillCampaignId/, 'delegación, no duplicación')
})
