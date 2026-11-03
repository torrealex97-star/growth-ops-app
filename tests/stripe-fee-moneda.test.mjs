import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { feeEnMonedaDelCobro } from '../lib/finance/stripeFees.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

// MONEY D2 · el `fee` de un balance_transaction viene en la moneda del SALDO de la cuenta, no del cobro.
//
// Incidente: una cuenta que cobra en EUR y liquida en USD guardaba el fee en DÓLARES como si fueran euros;
// la base comisionable (comisionable − fee) salía ~11-17 % más baja en el fee y todas las comisiones de
// esos cobros quedaban por debajo (~0,14 % del bruto por cobro). Los importes de abajo son casos reales
// verificados contra Stripe (sin datos personales).

test('saldo en USD, cobro en EUR: el fee se convierte con el tipo de cambio del propio cargo', () => {
  const txn = {
    currency: 'usd',
    exchange_rate: 1.12507,
    fee: 12163,
    fee_details: [{ amount: 9916 }, { amount: 2247 }],
  }
  // 121,63 USD / 1,12507 = 108,11 EUR (antes se guardaba 121,63 como si fueran euros)
  assert.equal(feeEnMonedaDelCobro(txn, 'eur'), 108.11)
})

test('otro cargo real: 63,38 USD a 1,16987 son 54,18 EUR', () => {
  assert.equal(feeEnMonedaDelCobro({ currency: 'usd', exchange_rate: 1.16987, fee: 6338 }, 'eur'), 54.18)
})

test('saldo en la misma moneda que el cobro: sin conversión (los pagos que liquidan en EUR no cambian)', () => {
  assert.equal(feeEnMonedaDelCobro({ currency: 'eur', exchange_rate: null, fee: 906 }, 'eur'), 9.06)
})

test('las monedas se comparan sin distinguir mayúsculas', () => {
  assert.equal(feeEnMonedaDelCobro({ currency: 'EUR', fee: 906 }, 'eur'), 9.06)
  assert.equal(feeEnMonedaDelCobro({ currency: 'USD', exchange_rate: 1.2, fee: 1200 }, 'EUR'), 10)
})

test('monedas distintas SIN tipo de cambio legible: no se adivina (null), nunca un importe en la moneda equivocada', () => {
  assert.equal(feeEnMonedaDelCobro({ currency: 'usd', exchange_rate: null, fee: 6338 }, 'eur'), null)
  assert.equal(feeEnMonedaDelCobro({ currency: 'usd', exchange_rate: 0, fee: 6338 }, 'eur'), null)
  assert.equal(feeEnMonedaDelCobro({ currency: 'usd', fee: 6338 }, 'eur'), null)
})

test('el detalle por concepto manda sobre `fee` cuando existe; sin ninguno de los dos, null', () => {
  assert.equal(
    feeEnMonedaDelCobro({ currency: 'eur', fee: 999, fee_details: [{ amount: 100 }, { amount: 50 }] }, 'eur'),
    1.5
  )
  assert.equal(feeEnMonedaDelCobro({ currency: 'eur' }, 'eur'), null)
  assert.equal(feeEnMonedaDelCobro(null, 'eur'), null)
})

test('sin moneda conocida en alguno de los lados se mantiene el comportamiento previo (céntimos / 100)', () => {
  assert.equal(feeEnMonedaDelCobro({ fee: 250 }, 'eur'), 2.5)
  assert.equal(feeEnMonedaDelCobro({ currency: 'eur', fee: 250 }), 2.5)
})

test('ningún lector de Stripe vuelve a hacer fee/100 a mano: todos pasan por la conversión compartida', () => {
  const resolve = leer('app/api/[tenant]/evergreen/sales/payment-inbox/resolve/route.ts')
  assert.match(resolve, /feeEnMonedaDelCobro\(/)
  assert.doesNotMatch(resolve, /txn\.fee\s*\/\s*100/)
  const conciliacion = leer('lib/finance/stripeReconciliation.ts')
  assert.match(conciliacion, /feeEnMonedaDelCobro\(/)
  assert.doesNotMatch(conciliacion, /balanceTx\.fee\s*\/\s*100/)
  const fees = leer('lib/finance/stripeFees.ts')
  assert.doesNotMatch(fees, /feeDeTxn/)
})
