import assert from 'node:assert/strict'
import { test } from 'node:test'

import { normalizarUtmContent, resolverAnuncioPorUtm } from '../lib/contacts/resolver-anuncio.ts'

// Caso REAL de la subcuenta (comprobado en base): el mismo nombre de anuncio ("ad2 | ...")
// se reutiliza en 3 campañas distintas — sin acotar por campaña, el nombre no es unívoco.
const catalogo = [
  { external_id: 'ad-vsl-10', name: 'AD+10+|+VSL+|+CLOSER|+AGO', campaign_external_id: 'camp-vsl' },
  { external_id: 'ad-vsl-18', name: 'AD+18+|+VSL+|+CLOSER|+AGO', campaign_external_id: 'camp-vsl' },
  {
    external_id: 'ad2-camp-a',
    name: 'AD2 | "CUANTO GANA UNA CLOSER" | TRAFICO PERFIL | MIDL FUNNEL',
    campaign_external_id: 'camp-a',
  },
  {
    external_id: 'ad2-camp-b',
    name: 'AD2 | "CUANTO GANA UNA CLOSER" | TRAFICO PERFIL | MIDL FUNNEL',
    campaign_external_id: 'camp-b',
  },
  // Mismo nombre, MISMA campaña: variantes/placements duplicados — ambiguo incluso acotando.
  { external_id: 'ad15-v1', name: 'AD 15 | VSL | CLOSER| AGO', campaign_external_id: 'camp-vsl' },
  { external_id: 'ad15-v2', name: 'AD 15 | VSL | CLOSER| AGO', campaign_external_id: 'camp-vsl' },
]

test("la normalización traduce '+' a espacios y colapsa, igual que resolver-campana", () => {
  assert.equal(normalizarUtmContent('AD+10+|+VSL+|+CLOSER|+AGO'), 'ad 10 | vsl | closer| ago')
})

test('match directo: utm_content casa el anuncio sincronizado dentro de su campaña', () => {
  const r = resolverAnuncioPorUtm('AD+10+|+VSL+|+CLOSER|+AGO', catalogo, { campaignExternalId: 'camp-vsl' })
  assert.deepEqual(r, { ok: true, kind: 'directa', adExternalId: 'ad-vsl-10' })
})

test('sin acotar por campaña, un nombre reutilizado en campañas distintas es AMBIGUO', () => {
  const r = resolverAnuncioPorUtm('AD2 | "CUANTO GANA UNA CLOSER" | TRAFICO PERFIL | MIDL FUNNEL', catalogo)
  assert.equal(r.ok, false)
  assert.equal(r.kind, 'ambigua')
  assert.deepEqual(new Set(r.candidates), new Set(['ad2-camp-a', 'ad2-camp-b']))
})

test('acotado a SU campaña, el mismo nombre deja de ser ambiguo', () => {
  const r = resolverAnuncioPorUtm('AD2 | "CUANTO GANA UNA CLOSER" | TRAFICO PERFIL | MIDL FUNNEL', catalogo, {
    campaignExternalId: 'camp-a',
  })
  assert.deepEqual(r, { ok: true, kind: 'directa', adExternalId: 'ad2-camp-a' })
})

test('variantes duplicadas DENTRO de la misma campaña siguen ambiguas: no se adivina cuál', () => {
  const r = resolverAnuncioPorUtm('AD 15 | VSL | CLOSER| AGO', catalogo, { campaignExternalId: 'camp-vsl' })
  assert.equal(r.ok, false)
  assert.equal(r.kind, 'ambigua')
})

test('sin utm_content, hueco honesto: sin_anuncio, no un match falso', () => {
  assert.deepEqual(resolverAnuncioPorUtm(null, catalogo), { ok: true, kind: 'sin_anuncio' })
  assert.deepEqual(resolverAnuncioPorUtm('', catalogo), { ok: true, kind: 'sin_anuncio' })
})

test('nombre sin ningún match en el catálogo: sin_anuncio, no ambiguo ni inventado', () => {
  const r = resolverAnuncioPorUtm('Anuncio que no existe en el catálogo', catalogo, { campaignExternalId: 'camp-vsl' })
  assert.deepEqual(r, { ok: true, kind: 'sin_anuncio' })
})
