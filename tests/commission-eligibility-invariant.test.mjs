import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const source = readFileSync(join(root, 'lib/commissions/generate.ts'), 'utf8')

test('hot path y reconciliación respetan la elegibilidad canónica del cobro', () => {
  assert.match(source, /if \(collection\.is_eligible_for_commission !== true\) return 0/)

  const reconcile = source.split('export async function reconcileSaleCommissions')[1]
  assert.match(reconcile, /\.eq\('needs_commission_review', false\)/)
  assert.match(reconcile, /\.eq\('is_eligible_for_commission', true\)/)
})
