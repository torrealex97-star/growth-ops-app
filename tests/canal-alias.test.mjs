import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizarCanal } from '../lib/contacts/canal-alias.ts'

test('los alias inequívocos de una red social se unifican, sin importar mayúsculas ni espacios', () => {
  for (const v of ['ig', 'IG', ' Instagram ', 'insta', 'instagram']) assert.equal(normalizarCanal(v), 'instagram', v)
  for (const v of ['fb', 'Facebook']) assert.equal(normalizarCanal(v), 'facebook', v)
  for (const v of ['tk', 'TikTok']) assert.equal(normalizarCanal(v), 'tiktok', v)
  assert.equal(normalizarCanal('YT'), 'youtube')
})

test('lo demás se deja EXACTAMENTE como viene: no se inventan equivalencias', () => {
  for (const v of [
    'meta_ads',
    'instagram_ads',
    'linktr.ee',
    'Directo / Sin atribuir',
    'campaña-ig-octubre',
    '12345678901234',
  ])
    assert.equal(normalizarCanal(v), v, v)
  assert.equal(normalizarCanal(null), null)
  assert.equal(normalizarCanal(undefined), undefined)
  assert.equal(normalizarCanal(''), '')
})
