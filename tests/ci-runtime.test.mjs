import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
const nextConfig = readFileSync(join(root, 'next.config.js'), 'utf8')

test('CI usa el runtime Node soportado', () => {
  assert.doesNotMatch(ci, /actions\/(checkout|setup-node)@v4/)
  assert.match(ci, /actions\/checkout@v7/)
  assert.match(ci, /actions\/setup-node@v7/)
  assert.match(ci, /node-version: 24/)
})

test('no vuelve un workflow de despliegue paralelo a la integración de Vercel', () => {
  // deploy.yml se borró en S0.4 (A0 §2.5): decía que la integración nativa no se pudo activar, cuando
  // es la que despliega cada commit, y le faltaban sus tres secrets. Sugería una vía de rollback que
  // no funcionaba. Si hace falta uno, que llegue con sus secrets y su porqué.
  assert.throws(() => readFileSync(join(root, '.github/workflows/deploy.yml')))
})

test('Next limita el trazado del artefacto a este repositorio', () => {
  assert.match(nextConfig, /outputFileTracingRoot: __dirname/)
})

// ── Menos ejecuciones: un PR en borrador no gasta CI ni previews; los cambios sin impacto en la app son ligeros.
test('el CI no corre en PRs en borrador y arranca al marcarlos como listos', () => {
  assert.match(ci, /types: \[opened, reopened, synchronize, ready_for_review\]/)
  assert.equal((ci.match(/github\.event\.pull_request\.draft != true/g) ?? []).length, 3, 'changes, gitleaks y gate')
})

test('skills de agente y docs cuentan como cambio sin impacto en la app (CI y Vercel)', () => {
  assert.match(ci, /':!\.agents\/\*\*' ':!\.claude\/skills\/\*\*'/)
  const vercel = readFileSync(join(root, 'vercel.json'), 'utf8')
  assert.match(vercel, /':!\.agents\/\*\*' ':!\.claude\/skills\/\*\*'/)
  const cfg = JSON.parse(vercel)
  for (const rama of ['dependabot/**', 'docs/**', 'claude/**'])
    assert.equal(cfg.git.deploymentEnabled[rama], false, rama)
})
