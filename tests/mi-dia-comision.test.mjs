import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync('components/dashboard/MiDia.tsx', 'utf8')

test('la comisión de «Mi día» usa el cálculo canónico y el veto pays_commissions', () => {
  assert.match(src, /commissionSettlementSummary/)
  assert.match(src, /pays_commissions !== false/)
  assert.match(src, /\.eq\('user_id', userId\)/)
})

test('sin datos de comisión se pinta un hueco, no un cero', () => {
  assert.match(src, /comision === null \? '—'/)
})
