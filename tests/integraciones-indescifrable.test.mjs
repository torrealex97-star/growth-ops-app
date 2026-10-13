// Aviso de credenciales indescifrables en Integraciones (lección GHL del 29-sep).
//
// Al rotar CONFIG_ENC_KEY, los valores guardados con la clave anterior quedan muertos: el runtime
// los descarta en silencio y TODO el código ve "faltan credenciales". El detector (lib/config.ts)
// los delata y el panel los señala. Se prueban las dos piezas:
//   1. `esIndescifrable` PURO: cifrar con la clave A no es descifrable con la clave B, y sí con la A.
//   2. El FUENTE del GET: marca `indescifrable` en el estado y lo sube como `clavesIndescifrables`.
// ||= y no ??= (hermeticidad; ver ghl-conversaciones-metricas.test.mjs)
process.env.CONFIG_ENC_KEY ||= 'clave-de-test-para-roundtrip-32-bytes-minimo'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://supafake.local'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'clave-de-test'

import assert from 'node:assert/strict'
import test from 'node:test'
import { createCipheriv, createHash, createHmac, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  encryptSecret,
  esIndescifrable,
  getConfigEncryptionKeyFingerprint,
  inspectEncryptedSecret,
} from '../lib/config.ts'

const aqui = dirname(fileURLToPath(import.meta.url))
const lee = (p) => readFileSync(join(aqui, '..', p), 'utf8')

test('esIndescifrable: cifrar con A y comprobar con A no es indescifrable', () => {
  const v = encryptSecret('pit-token-real')
  assert.equal(esIndescifrable(v), false)
})

test('esIndescifrable: cifrado con otra CONFIG_ENC_KEY sí lo es', () => {
  // Simula la rotación: cifra con la clave B y comprueba con la A del import — GCM debe
  // rechazar la autenticación, igual que el token huérfano de GHL.
  const keyB = createHash('sha256').update('clave-B-distinta', 'utf8').digest()
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keyB, iv)
  const enc = Buffer.concat([c.update('valor-de-la-key-anterior', 'utf8'), c.final()])
  const huérfano = 'enc:v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64')
  assert.equal(esIndescifrable(huérfano), true)
})

test('fingerprint distingue rotación de ciphertext corrupto sin intentar adivinar', () => {
  const rawB = 'B'.repeat(64)
  const keyB = createHash('sha256').update(rawB, 'utf8').digest()
  const fingerprintB = `hmac-sha256:v1:${createHmac('sha256', keyB)
    .update('growth-ops:config-enc-key-fingerprint:v1', 'utf8')
    .digest('hex')
    .slice(0, 24)}`
  const current = getConfigEncryptionKeyFingerprint()
  assert.notEqual(fingerprintB, current)

  const encrypted = encryptSecret('valor-protegido')
  assert.deepEqual(inspectEncryptedSecret(encrypted, current), {
    status: 'ok',
    decryptable: true,
    fingerprintMatches: true,
  })
  assert.deepEqual(inspectEncryptedSecret(encrypted, fingerprintB), {
    status: 'fingerprint_mismatch',
    decryptable: false,
    fingerprintMatches: false,
  })
  assert.equal(inspectEncryptedSecret('enc:v1:no-es-base64-valida', current).status, 'decrypt_error')
})

test('esIndescifrable: vacío, en claro y basura no indescifrable (no confunde estados)', () => {
  assert.equal(esIndescifrable(null), false)
  assert.equal(esIndescifrable(''), false)
  assert.equal(esIndescifrable('token-en-claro-viejo'), false, 'los valores pre-cifrado no se marcan')
  assert.equal(esIndescifrable('enc:v1:no-es-base64-valida'), true, 'basura con prefijo: GCM falla')
})

test('el GET de Integraciones marca el campo y sube la lista al front', () => {
  const fuente = lee('app/api/[tenant]/evergreen/settings/integraciones/route.ts')
  assert.match(fuente, /inspectEncryptedSecret\(inDb/, 'el estado se calcula con el detector tipado')
  assert.match(fuente, /indescifrable: true/, 'el estado marca el campo')
  assert.match(fuente, /clavesIndescifrables/, 'la respuesta sube la lista')
  assert.match(fuente, /key_fingerprint/, 'guarda y verifica el fingerprint')
  assert.match(fuente, /savedKeys/, 'la respuesta confirma exactamente qué claves persistió')
  const ui = lee('app/[tenant]/settings/integraciones/page.tsx')
  assert.match(ui, /clavesIndescifrables/, 'la UI consume la lista')
  assert.match(ui, /clave no coincide/, 'badge distingue el mismatch de llave')
  assert.match(ui, /cifrado dañado/, 'badge distingue corrupción real')
  assert.match(ui, /servidor comprobará la fila persistida/, 'banner explica la verificación post-save')
})

test('CONFIG_ENC_KEY ausente o corta falla de forma explícita, sin fallback aleatorio', () => {
  const probe = `import { assertConfigEncryptionReady } from './lib/config.ts'; assertConfigEncryptionReady()`
  for (const candidate of [undefined, 'demasiado-corta']) {
    const env = { ...process.env }
    if (candidate === undefined) delete env.CONFIG_ENC_KEY
    else env.CONFIG_ENC_KEY = candidate
    const result = spawnSync(
      process.execPath,
      ['--import', './tests/register.mjs', '--input-type=module', '--eval', probe],
      { cwd: join(aqui, '..'), env, encoding: 'utf8' }
    )
    assert.notEqual(result.status, 0)
    assert.match(`${result.stderr}${result.stdout}`, /CONFIG_ENC_KEY/)
  }
})

test('CI declara una llave de prueba estable para build y runtime E2E', () => {
  const workflow = lee('.github/workflows/ci.yml')
  assert.match(workflow, /CONFIG_ENC_KEY: ci-build-only-config-encryption-key-32-bytes/)
  assert.equal(
    workflow.match(/CONFIG_ENC_KEY: ci-e2e-only-config-encryption-key-32-bytes/g)?.length,
    2,
    'build y runtime E2E deben compartir exactamente la misma llave QA'
  )
})

test('existe un diagnóstico admin que no devuelve valores ni fingerprints', () => {
  const source = lee('app/api/[tenant]/evergreen/settings/integraciones/crypto-diagnostics/route.ts')
  assert.match(source, /auth\.administraTenant/)
  assert.match(source, /decryptable/)
  assert.match(source, /fingerprintMatches/)
  assert.match(source, /Nunca devuelve valores, ciphertexts, llaves ni fingerprints/)
})
