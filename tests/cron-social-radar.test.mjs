import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  isRadarAutoEnabled,
  parseRadarUsernames,
  radarDailyDedupeScope,
  RADAR_AUTO_MAX_JOBS_PER_RUN,
  sortTenantsByOldestRun,
} from '../lib/social/radar-auto.ts'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')
const routePath = 'app/api/[tenant]/evergreen/cron/social-radar/route.ts'

test('el opt-in es explícito y los perfiles quedan normalizados, deduplicados y sin la cuenta propia', () => {
  assert.equal(isRadarAutoEnabled(undefined), false)
  assert.equal(isRadarAutoEnabled('0'), false)
  assert.equal(isRadarAutoEnabled('1'), true)
  assert.deepEqual(parseRadarUsernames(' @Alpha, alpha\npropia;usuario-invalido! beta ', ['@propia'], 10), [
    'alpha',
    'beta',
  ])
  assert.deepEqual(parseRadarUsernames('uno dos tres', [], 2), ['uno', 'dos'])
})

test('la deduplicación automática comparte un scope durante todo el día UTC', () => {
  assert.equal(radarDailyDedupeScope(new Date('2026-10-12T00:01:00Z')), 'radar:2026-10-12')
  assert.equal(radarDailyDedupeScope(new Date('2026-10-12T23:59:00Z')), 'radar:2026-10-12')
})

test('la selección es justa: primero quien nunca corrió y después la corrida más antigua', () => {
  const ordered = sortTenantsByOldestRun(
    [{ id: 'b' }, { id: 'a' }, { id: 'c' }],
    new Map([
      ['b', '2026-10-12T10:00:00Z'],
      ['c', '2026-10-11T10:00:00Z'],
    ])
  )
  assert.deepEqual(
    ordered.map((tenant) => tenant.id),
    ['a', 'c', 'b']
  )
})

test('el cron exige CRON_SECRET, lee el opt-in local y limita el gasto global', () => {
  const route = read(routePath)
  assert.match(route, /auth !== `Bearer \$\{process\.env\.CRON_SECRET\}`/)
  assert.match(route, /APIFY_RADAR_AUTO_ENABLED/)
  assert.match(route, /integration_settings/)
  assert.match(route, /getTenantConfigWithFallback\(tenant\.id/)
  assert.match(route, /prepared\.length >= RADAR_AUTO_MAX_JOBS_PER_RUN/)
  assert.equal(RADAR_AUTO_MAX_JOBS_PER_RUN, 3)
  assert.match(route, /Promise\.allSettled/)
  assert.match(route, /recordSyncRun/)
  assert.match(route, /reconcileResearchJobs\(sb, cfg, tenant\.id\)/)
  assert.match(route, /dedupeScope: radarDailyDedupeScope\(\)/)
  assert.doesNotMatch(route, /process\.env\.APIFY_RADAR_AUTO_ENABLED/)
})

test('el workflow diario está delegado, no duplica un cron Vercel y puede reintentarse a mano', () => {
  const workflow = read('.github/workflows/cron-social-radar.yml')
  assert.match(workflow, /name: 'cron: social-radar'/)
  assert.match(workflow, /- cron: '50 3 \* \* \*'/)
  assert.match(workflow, /workflow_dispatch:/)
  assert.match(workflow, /\/api\/_\/evergreen\/cron\/social-radar/)
  assert.match(workflow, /secrets\.CRON_SECRET/)
  const vercel = JSON.parse(read('vercel.json'))
  assert.ok(!(vercel.crons || []).some((cron) => cron.path.includes('social-radar')))
})

test('catálogo, salud y UI explican coste, activación y frescura sin convertir huecos en cero', () => {
  const catalog = read('lib/integrations-catalog.ts')
  const health = read('lib/ops/sync-health.ts')
  const groups = read('lib/integrations/health.ts')
  const radarApi = read('app/api/[tenant]/evergreen/social/radar/route.ts')
  const radarPage = read('components/social/ContentRadarWorkspace.tsx')
  assert.match(catalog, /key: 'APIFY_RADAR_AUTO_ENABLED'/)
  assert.match(catalog, /Desactivado por defecto/)
  assert.match(catalog, /consumirá créditos/)
  assert.match(health, /id: 'social-radar'/)
  assert.match(health, /cron-social-radar\.yml/)
  assert.match(groups, /apify: \['social-radar'\]/)
  assert.match(radarApi, /latestObservedAt/)
  assert.match(radarPage, /Radar automático desactivado/)
  assert.match(radarPage, /Todavía no hay una observación externa disponible/)
})
