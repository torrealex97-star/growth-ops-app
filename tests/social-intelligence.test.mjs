import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanSocialMetric,
  engagementRate,
  isSuspiciousReach,
  parseSocialVideoUrl,
  rankRadarPosts,
  viewsPerHour,
} from '../lib/social/intelligence.ts'
import { InstagramReelsAdapter } from '../lib/social/normalize.ts'
import { readFileSync } from 'node:fs'

test('normaliza reels de Instagram sin conservar parámetros de tracking', () => {
  assert.deepEqual(parseSocialVideoUrl('https://www.instagram.com/reel/ABC123/?igsh=secret'), {
    platform: 'instagram',
    externalId: 'ABC123',
    canonicalUrl: 'https://www.instagram.com/reel/ABC123/',
  })
  assert.equal(parseSocialVideoUrl('https://example.com/reel/ABC123'), null)
})

test('métricas ausentes y negativas permanecen desconocidas, no se convierten a cero', () => {
  assert.equal(cleanSocialMetric(null), null)
  assert.equal(cleanSocialMetric(-4), null)
  assert.equal(engagementRate({ views: 1000, likes: null, comments: null, shares: null }), null)
  assert.equal(engagementRate({ views: 1000, likes: 40, comments: 5, shares: 5 }), 5)
})

test('velocidad y señal sospechosa se calculan con denominadores explícitos', () => {
  const now = new Date('2026-10-12T12:00:00Z')
  assert.equal(viewsPerHour(2400, '2026-10-12T10:00:00Z', now), 1200)
  assert.equal(isSuspiciousReach(20_000, 20), true)
  assert.equal(isSuspiciousReach(20_000, null), false)
})

test('radar prioriza outlier relativo y conserva el flag de calidad', () => {
  const ranked = rankRadarPosts(
    [
      { id: 'a', username: 'creator', views_count: 1000, likes_count: 30, published_at: '2026-10-12T10:00:00Z' },
      { id: 'b', username: 'creator', views_count: 10_000, likes_count: 10, published_at: '2026-10-12T11:00:00Z' },
    ],
    new Date('2026-10-12T12:00:00Z')
  )
  assert.equal(ranked[0].id, 'b')
  assert.equal(ranked[0].suspicious_reach, false)
  assert.ok(ranked[0].outlier_score > ranked[1].outlier_score)
})

test('reel por URL usa el contrato exacto del actor y conserva transcripción', () => {
  const input = InstagramReelsAdapter.buildInput(
    { jobType: 'reel', usernames: [], urls: ['https://www.instagram.com/reel/ABC/'], resultsLimit: 1 },
    1
  )
  assert.deepEqual(input, {
    username: ['https://www.instagram.com/reel/ABC/'],
    resultsLimit: 1,
    includeTranscript: true,
  })
  const result = InstagramReelsAdapter.normalize([{ shortCode: 'ABC', transcript: 'Hook real', videoViewCount: 0 }], [])
  assert.equal(result.posts[0].transcript, 'Hook real')
  assert.equal(result.posts[0].viewsCount, 0)
})

test('la migración conserva null, RLS, tenant scope e índices para radar', () => {
  const sql = readFileSync(
    new URL('../supabase/migrations/20261012074534_instagram_intelligence.sql', import.meta.url),
    'utf8'
  )
  assert.match(sql, /social_post_metric_snapshots enable row level security/i)
  assert.match(sql, /auth_tenant_ids\(\)/)
  assert.match(sql, /is_admin_or_director\(\)/)
  assert.match(sql, /idx_social_posts_tenant_published_views/)
  assert.match(sql, /views_count is null or views_count >= 0/)
})

test('las miniaturas externas caducadas degradan a un estado limpio en toda la sección', () => {
  const thumbnail = readFileSync(new URL('../components/social/ExternalThumbnail.tsx', import.meta.url), 'utf8')
  assert.match(thumbnail, /onError=\{\(\) => setFailed\(true\)\}/)
  assert.match(thumbnail, /referrerPolicy="no-referrer"/)
  assert.match(thumbnail, /Miniatura no disponible/)

  for (const page of [
    'page.tsx',
    'radar/page.tsx',
    'reels/page.tsx',
    'competencia/page.tsx',
    'investigacion/page.tsx',
  ]) {
    const source = readFileSync(new URL(`../app/[tenant]/instagram/${page}`, import.meta.url), 'utf8')
    assert.match(source, /ExternalThumbnail/, `${page} debe usar el fallback compartido`)
  }

  const investigation = readFileSync(
    new URL('../app/[tenant]/instagram/investigacion/page.tsx', import.meta.url),
    'utf8'
  )
  assert.match(investigation, /max-h-\[32rem\] w-full.*xl:max-h-none/)
})
