import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluar, EXCEPCIONES } from '../scripts/auditar-dependencias.mjs'

const aviso = (paquete, ghsa, severity) => ({
  vulnerabilities: { [paquete]: { via: [{ severity, url: `https://github.com/advisories/${ghsa}` }] } },
})

test('un aviso alto sin excepción bloquea', () => {
  const r = evaluar(aviso('x', 'GHSA-aaaa-bbbb-cccc', 'high'), new Date('2026-11-18'))
  assert.equal(r.bloqueantes.length, 1)
})

test('un aviso alto exceptuado y vigente no bloquea', () => {
  const r = evaluar(aviso('picomatch', EXCEPCIONES[0].ghsa, 'high'), new Date('2026-11-18'))
  assert.equal(r.bloqueantes.length, 0)
  assert.equal(r.exceptuados.length, 1)
})

test('una excepción caducada vuelve a bloquear', () => {
  const r = evaluar(aviso('picomatch', EXCEPCIONES[0].ghsa, 'high'), new Date('2027-01-01'))
  assert.equal(r.caducadas.length, 1)
})

test('los avisos moderados no bloquean', () => {
  const r = evaluar(aviso('glob', 'GHSA-zzzz-zzzz-zzzz', 'moderate'), new Date('2026-11-18'))
  assert.equal(r.bloqueantes.length, 0)
})

test('toda excepción lleva motivo y caducidad', () => {
  for (const e of EXCEPCIONES) {
    assert.ok(e.motivo.length > 20 && /^\d{4}-\d{2}-\d{2}$/.test(e.caduca))
  }
})
