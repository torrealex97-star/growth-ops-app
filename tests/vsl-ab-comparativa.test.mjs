import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')
const route = read('app/api/[tenant]/evergreen/vsl/ab-comparativa/route.ts')
const dashboard = read('components/vsl/VslDashboard.tsx')
const runbook = read('docs/VSL_AB_OCT26.md')

test('la comparativa semanal vive en una ruta autenticada, ya no en SQL a mano', () => {
  assert.match(route, /requirePantalla\(tenant, '\/marketing\/adquisicion\/vsl'\)/)
  assert.match(route, /v\.tenant_id = \$\{tenantId\}/)
  assert.match(route, /ab-comparativa/)
})

test('la ruta calcula los mismos hitos que el SQL del runbook (25/50/95 sobre max_position)', () => {
  assert.match(route, /max_position >= s\.duration \* 0\.25/)
  assert.match(route, /max_position >= s\.duration \* 0\.50/)
  assert.match(route, /max_position >= s\.duration \* 0\.95/)
  assert.match(route, /LEFT JOIN vsl_sessions s ON s\.video_id = v\.id AND s\.tenant_id = v\.tenant_id/)
})

test('sin plays el hito es «no hay muestra» (null), nunca cero', () => {
  // Un hueco no es un cero: la ruta devuelve null y el panel pinta «—».
  assert.match(route, /plays > 0 \? pct\(Number\(f\.h25\), plays\) : null/)
  assert.match(dashboard, /=== null \? '\u2014' :/)
})

test('el filtro opcional `slugs` limita a vídeo(s) del tenant propio y a 5 como mucho', () => {
  assert.match(route, /new URL\(req\.url\)\.searchParams\.get\('slugs'\)/)
  assert.match(route, /\.slice\(0, 5\)/)
  assert.match(route, /v\.slug = ANY\(\$\{listaSlugs\}::text\[\]\)/)
})

test('el panel VSL muestra la comparativa y se recupera de un error de red', () => {
  assert.match(dashboard, /<ComparativaHitos tenant=\{tenant\}/)
  assert.match(dashboard, /fetch\(`\/api\/\$\{tenant\}\/evergreen\/vsl\/ab-comparativa`\)/)
  assert.match(dashboard, /setError\(true\)/)
  assert.match(dashboard, /No se pudo calcular la comparativa ahora mismo/)
  assert.match(dashboard, /Reintentar/)
})

test('el runbook deja de pedir SQL a mano y apunta al panel', () => {
  assert.match(runbook, /ab-comparativa/)
})
