import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readPaymentInbox } from '../lib/sales/payment-inbox.ts'

// Cliente falso: devuelve filas por tabla y apunta qué se pidió (columnas y filtros).
function fakeSb(tablas) {
  const log = []
  const from = (tabla) => {
    const op = { tabla, columnas: '', filtros: [] }
    log.push(op)
    const q = {
      select: (c) => ((op.columnas = c), q),
      eq: (c, v) => (op.filtros.push(['eq', c, v]), q),
      in: (c, v) => (op.filtros.push(['in', c, v]), q),
      not: (c, o, v) => (op.filtros.push(['not', c, o, v]), q),
      order: () => q,
      range: async () => ({ data: tablas[tabla] ?? [], error: null }),
    }
    return q
  }
  return { sb: { from }, log }
}

const pago = (o) => ({
  payment_id: 'pi_1',
  charge_id: 'ch_1',
  customer_id: 'cus_1',
  customer_email: 'trabajo@x.com',
  amount: 100,
  refunded_amount: 0,
  currency: 'eur',
  status: 'succeeded',
  paid_at: '2026-10-01T10:00:00Z',
  ...o,
})

test('la bandeja no descarga el JSON completo de custom_fields de todos los contactos', async () => {
  const { sb, log } = fakeSb({ stripe_payments: [pago()], contacts: [] })
  await readPaymentInbox(sb, 'T1', null)
  const contactos = log.find((o) => o.tabla === 'contacts')
  assert.doesNotMatch(contactos.columnas, /(^|,)custom_fields(,|$)/)
  assert.match(contactos.columnas, /emails_alternativos:custom_fields->emails_alternativos/)
  assert.ok(contactos.filtros.some((f) => f[1] === 'tenant_id' && f[2] === 'T1'))
})

test('los pagos y cobros se filtran en la base con condiciones equivalentes a las que ya se aplicaban', async () => {
  const { sb, log } = fakeSb({})
  await readPaymentInbox(sb, 'T1', null)
  const pagos = log.find((o) => o.tabla === 'stripe_payments')
  assert.deepEqual(
    pagos.filtros.find((f) => f[0] === 'in'),
    ['in', 'status', ['succeeded', 'partially_refunded']]
  )
  const cobros = log.find((o) => o.tabla === 'collections')
  assert.ok(cobros.filtros.some((f) => f[0] === 'not' && f[1] === 'payment_reference'))
})

test('quien paga con un correo alternativo recordado sigue encajando con su contacto', async () => {
  const { sb } = fakeSb({
    stripe_payments: [pago()],
    contacts: [
      { id: 'c1', email: 'principal@x.com', full_name: 'Ana', emails_alternativos: ['Trabajo@x.com'] },
      { id: 'c2', email: 'otra@x.com', full_name: 'Otra', emails_alternativos: null },
    ],
  })
  const filas = await readPaymentInbox(sb, 'T1', null)
  assert.equal(filas.length, 1)
  assert.equal(filas[0].contactId, 'c1')
  assert.equal(filas[0].identitySource, 'alias')
})

test('un pago ya registrado como cobro no sale pendiente', async () => {
  const { sb } = fakeSb({
    stripe_payments: [pago(), pago({ payment_id: 'pi_2', charge_id: 'ch_2' })],
    contacts: [{ id: 'c1', email: 'trabajo@x.com', full_name: 'Ana', emails_alternativos: null }],
    collections: [{ payment_reference: 'pi_1' }],
  })
  const filas = await readPaymentInbox(sb, 'T1', null)
  assert.deepEqual(
    filas.map((f) => f.payment_id),
    ['pi_2']
  )
})

test('abrir un cobro usa pedir(): con techo de tiempo y sin .json() a pelo', () => {
  const c = readFileSync('components/sales/PaymentInbox.tsx', 'utf8')
  assert.match(c, /pedir<Detail>\(\s*`\/api\/\$\{tenant\}\/evergreen\/sales\/payment-inbox\?payment=/)
  assert.match(c, /timeoutMs: 58_000/)
})

test('recuperar el foco no relanza la lectura completa de la bandeja más de una vez cada 30 s', () => {
  const c = readFileSync('components/sales/PaymentInbox.tsx', 'utf8')
  assert.match(c, /Date\.now\(\) - ultimaPorFoco < 30_000/)
  assert.match(c, /addEventListener\('focus', alVolver\)/)
  assert.match(c, /removeEventListener\('focus', alVolver\)/)
})

test('con soloPago se lee en la base solo ese pago, sus referencias y su cliente, con el mismo resultado', async () => {
  const { sb, log } = fakeSb({
    stripe_payments: [pago()],
    contacts: [{ id: 'c1', email: 'trabajo@x.com', full_name: 'Ana', emails_alternativos: null }],
  })
  const filas = await readPaymentInbox(sb, 'T1', null, { soloPago: 'pi_1' })
  assert.equal(filas.length, 1)
  assert.equal(filas[0].contactId, 'c1')
  const pagos = log.find((o) => o.tabla === 'stripe_payments')
  assert.ok(pagos.filtros.some((f) => f[0] === 'eq' && f[1] === 'payment_id' && f[2] === 'pi_1'))
  const cobros = log.find((o) => o.tabla === 'collections')
  assert.deepEqual(
    cobros.filtros.find((f) => f[0] === 'in'),
    ['in', 'payment_reference', ['pi_1', 'ch_1']]
  )
  const clientes = log.find((o) => o.tabla === 'stripe_customers')
  assert.deepEqual(
    clientes.filtros.find((f) => f[0] === 'in'),
    ['in', 'stripe_customer_id', ['cus_1']]
  )
})

test('con soloPago y un pago inexistente no se leen más tablas', async () => {
  const { sb, log } = fakeSb({ stripe_payments: [] })
  assert.deepEqual(await readPaymentInbox(sb, 'T1', null, { soloPago: 'pi_x' }), [])
  assert.equal(log.filter((o) => o.tabla === 'contacts').length, 0)
})
