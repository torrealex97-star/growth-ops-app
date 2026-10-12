import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfigWithFallback } from '@/lib/config'
import { analyzeReel } from '@/lib/ai/claude'
import { engagementRate } from '@/lib/social/intelligence'

export const runtime = 'nodejs'
export const maxDuration = 60

const ALLOWED_ROLES = ['admin', 'director', 'manager', 'marketing']
const svc = () => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!auth.role || !ALLOWED_ROLES.includes(auth.role)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  const body = (await req.json().catch(() => null)) as { postId?: string } | null
  if (!body?.postId) return NextResponse.json({ error: 'Falta el contenido' }, { status: 400 })

  const sb = svc()
  const { data: post } = await sb
    .from('social_posts')
    .select('id, caption, transcript, views_count, likes_count, comments_count, shares_count, analysis_json')
    .eq('tenant_id', auth.tenantId)
    .eq('id', body.postId)
    .maybeSingle()
  if (!post) return NextResponse.json({ error: 'Contenido no encontrado' }, { status: 404 })
  if (post.analysis_json) {
    return NextResponse.json({ analysis: post.analysis_json, cached: true })
  }
  if (!post.transcript?.trim()) {
    return NextResponse.json(
      { error: 'El proveedor no devolvió transcripción para este reel; no se generará un análisis inventado.' },
      { status: 422 }
    )
  }

  try {
    const env = await getTenantConfigWithFallback(auth.tenantId, true)
    const engagement = engagementRate({
      views: post.views_count,
      likes: post.likes_count,
      comments: post.comments_count,
      shares: post.shares_count,
    })
    const analysis = await analyzeReel(
      post.transcript,
      { caption: post.caption || undefined, views: post.views_count ?? undefined, engagement: engagement ?? undefined },
      env
    )
    const analyzedAt = new Date().toISOString()
    const { error } = await sb
      .from('social_posts')
      .update({ analysis_json: analysis, analysis_status: 'ready', analyzed_at: analyzedAt })
      .eq('tenant_id', auth.tenantId)
      .eq('id', post.id)
    if (error) throw error
    return NextResponse.json({ analysis, analyzedAt })
  } catch (error) {
    await sb.from('social_posts').update({ analysis_status: 'failed' }).eq('tenant_id', auth.tenantId).eq('id', post.id)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo analizar el reel' },
      { status: 502 }
    )
  }
}
