import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('la sync de medias de Instagram va en lotes paralelos con presupuesto de tiempo', () => {
  const s = leer('lib/instagram/sync.ts')
  assert.match(s, /const LOTE = 6/)
  assert.match(s, /Promise\.all\(\s*lote\.map/)
  assert.match(s, /presupuestoMs \?\? 38_000/)
  assert.match(s, /if \(Date\.now\(\) > limite\)/)
  // Se guarda por lote, no al final: un corte no pierde lo ya leído.
  assert.match(s, /\.upsert\(filas, \{ onConflict: 'tenant_id,external_id'/)
  assert.doesNotMatch(s, /for \(const m of medias\) \{\s*let ins/)
})

test('una conexión de Google marcada por el fallo antiguo del permiso email se repara sola', () => {
  const s = leer('app/api/[tenant]/evergreen/oauth/google/connections/route.ts')
  assert.match(s, /startsWith\('Faltan permisos concedidos'\)/)
  assert.match(s, /ambitosFaltantes\(SCOPES\[fila\.provider\], fila\.scopes\.join\(' '\)\)\.length === 0/)
  assert.match(s, /status: 'conectada', last_error: null/)
})

test('los pasos opcionales de Instagram solo arrancan con margen y cada paso deja su tiempo en el log', () => {
  const s = leer('lib/instagram/sync.ts')
  assert.match(s, /margenOpcionalesMs \?\? 42_000/)
  assert.equal((s.match(/if \(!hayMargen\(\)\) throw new Error\('sin margen'\)/g) || []).length, 2)
  assert.ok((s.match(/marca\(/g) || []).length >= 6)
})
