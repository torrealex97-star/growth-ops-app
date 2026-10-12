import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { engagementRate, rankRadarPosts } from '@/lib/social/intelligence'

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing']
const svc = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!auth.role || !ALLOWED_ROLES.includes(auth.role)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const now = new Date()
  const since48h = new Date(now.getTime() - 48 * 3_600_000).toISOString()
  const sb = svc()
  const { data, error } = await sb
    .from('social_posts')
    .select(
      'id, platform, external_id, profile_id, caption, post_url, thumbnail_url, published_at, views_count, likes_count, comments_count, shares_count, collected_at, source, analysis_status, analysis_json, social_profiles(username, display_name)'
    )
    .eq('tenant_id', auth.tenantId)
    .gte('published_at', since48h)
    .order('views_count', { ascending: false, nullsFirst: false })
    .limit(250)
  if (error) return NextResponse.json({ error: 'No se pudo cargar el radar' }, { status: 500 })

  const normalized = (data || []).map((post) => {
    const profile = Array.isArray(post.social_profiles) ? post.social_profiles[0] : post.social_profiles
    return { ...post, username: profile?.username || null, display_name: profile?.display_name || null }
  })
  const last24h = normalized.filter(
    (post) => post.published_at && new Date(post.published_at).getTime() >= now.getTime() - 24 * 3_600_000
  )
  const windowHours = last24h.length >= 15 ? 24 : 48
  const windowPosts = windowHours === 24 ? last24h : normalized
  const eligible = windowPosts.filter((post) => post.views_count != null && post.views_count >= 2_000)
  const ranked = rankRadarPosts(eligible, now)
    .slice(0, 50)
    .map((post) => ({
      ...post,
      engagement_rate: engagementRate({
        views: post.views_count,
        likes: post.likes_count,
        comments: post.comments_count,
        shares: post.shares_count,
      }),
    }))
  const observed = windowPosts.filter((post) => post.views_count != null).length
  return NextResponse.json({
    windowHours,
    posts: ranked,
    health: {
      total: ranked.length,
      metricsCoverage: windowPosts.length ? Math.round((observed / windowPosts.length) * 100) : 0,
      status:
        windowPosts.length === 0 ? 'insufficient_data' : observed / windowPosts.length >= 0.8 ? 'healthy' : 'partial',
      generatedAt: now.toISOString(),
    },
  })
}
