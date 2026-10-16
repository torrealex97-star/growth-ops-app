import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync('app/[tenant]/ventas/registro/page.tsx', 'utf8')

test('el origen colaboradora manda sobre el UTM en el registro de ventas', () => {
  assert.match(src, /collaborator_id/)
  const i = src.indexOf('colabByContact.get')
  const j = src.indexOf('channelByContact.get(s.contact_id)')
  assert.ok(i > -1 && j > -1 && i < j, 'la colaboradora se resuelve antes que el UTM')
})

test('la colaboradora ve una vista sencilla: sin bandeja, sin nueva venta, sin desglose por origen', () => {
  assert.match(src, /!esColab && <PaymentInbox/)
  assert.match(src, /!esColab && salesByChannel\.length > 0/)
})
