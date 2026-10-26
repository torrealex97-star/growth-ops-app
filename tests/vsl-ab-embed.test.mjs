import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { elegirVarianteAb, parseAbPair } from '../lib/vsl/ab.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')
const embed = read('app/embed/vsl/[slug]/page.tsx')

test('parseAbPair exige exactamente dos slugs válidos y distintos', () => {
  const buenas = ['vsl-ab-a-oct26, vsl-ab-b-oct26', 'vsl-ab-a-oct26,vsl-ab-b-oct26   ']
  for (const raw of buenas) {
    assert.deepEqual(parseAbPair(raw), {
      varianteA: 'vsl-ab-a-oct26',
      varianteB: 'vsl-ab-b-oct26',
    })
  }
  const malas = [
    null,
    undefined,
    '',
    '   ',
    'solo-uno', // sin coma
    'a,b,c', // tres partes
    'vsl-ab-a-oct26,vsl-ab-a-oct26', // iguales
    'Vsl Ab A,vsl-ab-b-oct26', // espacios/caracteres raros
    'vsl-ab-a-oct26,vsl-ab-b-oct26;DROP TABLE', // inyección nunca alcanza a resolver
    `x,${'a'.repeat(61)}`, // más largo del tope de slugify
  ]
  for (const raw of malas) assert.equal(parseAbPair(raw), null, `debería rechazar: ${raw}`)
})

test('elegirVarianteAb reparte 50/50 con moneda inyectable', () => {
  const par = parseAbPair('vsl-ab-a-oct26,vsl-ab-b-oct26')
  assert.equal(elegirVarianteAb(par, 0.0), 'vsl-ab-a-oct26') // [0, 0.5) → A
  assert.equal(elegirVarianteAb(par, 0.4999), 'vsl-ab-a-oct26')
  assert.equal(elegirVarianteAb(par, 0.5), 'vsl-ab-b-oct26')
  assert.equal(elegirVarianteAb(par, 0.99), 'vsl-ab-b-oct26')
})

test('el embed degrada en vez de romperse: el A/B nunca tumba un embed vivo', () => {
  // El par se lee de `?ab=` y solo actúa si las DOS variantes resuelven en la misma cuenta.
  // Cualquier fallo (par raro, variante inexistente, BD caída) queda atrapado y el embed
  // sirve el vídeo pedido.
  assert.match(embed, /searchParams: Promise<\{ tenant\?: string; ab\?: string \}>/)
  assert.match(embed, /const par = parseAbPair\(ab\)/)
  assert.match(
    embed,
    /await Promise\.all\(\[\s*resolvePublicVsl\(par\.varianteA, tenant\),\s*resolvePublicVsl\(par\.varianteB, tenant\),?\s*\]\)/
  )
  assert.match(embed, /elegirVarianteAb\(par, Math\.random\(\)\)/)
  assert.match(embed, /candidata\.video\.tenant_slug === resolution\.video\.tenant_slug/)
  assert.match(embed, /if \(mismaCuenta\) resolution = candidata/)
  assert.match(embed, /catch \(e\) \{[\s\S]*console\.error\('\[vsl\/ab\]/)
})

test('el reparto es por carga (force-dynamic), sin cookies ni estado nuevo', () => {
  assert.match(embed, /export const dynamic = 'force-dynamic'/)
  assert.doesNotMatch(embed, /cookies\(|localStorage|sessionStorage/)
})
