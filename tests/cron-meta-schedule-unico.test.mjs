import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')

// El cron de Meta tiene UNA cadencia prevista: diario 03:00 UTC por GitHub Actions
// (cron-meta.yml) y los crons de vercel.json (meta-ads 02:00, reminders 07:00 — Hobby admite
// solo 2). Hubo un activador a demanda (botón «Auto 30 min» en Campañas) que programaba en
// Supabase pg_cron `meta-sync-30min-<tenant>` con `*/30 * * * *` vía pg_net; duplicaba las
// ejecuciones previstas y era invisible en el catálogo de crons. Esta prueba impide volver a
// introducir una cadencia sub-diaria de Meta en código o workflows.

test('el workflow de Actions de Meta es diario y sin cadencia sub-diaria', () => {
  const yml = read('.github/workflows/cron-meta.yml')
  assert.match(yml, /cron: '0 3 \* \* \*'/)
  assert.doesNotMatch(yml, /\*\/\d+ \*/)
})

test('vercel.json no programa /cron/meta y no hay cadencia sub-diaria', () => {
  const vercel = read('vercel.json')
  assert.doesNotMatch(vercel, /cron\/meta(?![\w-])/)
  assert.doesNotMatch(vercel, /\*\/\d+ \*/)
})

test('setup-meta-cron ya no programa nada: solo desprograma el job residual', () => {
  const ruta = read('app/api/[tenant]/evergreen/admin/setup-meta-cron/route.ts')
  assert.doesNotMatch(ruta, /cron\.schedule/)
  assert.doesNotMatch(ruta, /\*\/30/)
  assert.match(ruta, /cron\.unschedule/)
  // El POST quedó retirado: responder 405 con la explicación de dónde vive el schedule previsto.
  assert.match(ruta, /export async function POST\(\)/)
  assert.match(ruta, /status: 405/)
})

test('la UI de Campañas ya no activa el cron de 30 minutos', () => {
  const pagina = read('app/[tenant]/marketing/adquisicion/campanas/page.tsx')
  assert.doesNotMatch(pagina, /setup-meta-cron/)
  assert.doesNotMatch(pagina, /Auto 30 min/)
})
