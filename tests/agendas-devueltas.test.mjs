import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contactosDevueltos } from '../lib/appointments/devueltas.ts'

test('marca a quien tiene un pago de Stripe devuelto por email, sin distinguir mayúsculas', () => {
  const r = contactosDevueltos(
    [
      { id: 'a', email: 'Erk@x.test' },
      { id: 'b', email: 'b@x.test' },
    ],
    [
      { customer_email: 'erk@x.test', status: 'refunded' },
      { customer_email: 'b@x.test', status: 'succeeded' },
    ],
    []
  )
  assert.deepEqual([...r], ['a'])
})

test('una venta refunded también marca, y un contacto sin email no se cruza con nada', () => {
  const r = contactosDevueltos(
    [
      { id: 'a', email: null },
      { id: 'b', email: '' },
    ],
    [{ customer_email: '', status: 'refunded' }],
    [{ contact_id: 'a', status: 'refunded' }]
  )
  assert.deepEqual([...r], ['a'])
})
