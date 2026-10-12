// Adapted from the MIT-licensed instagram-research-tool by manthanpatelll.
// The implementation is intentionally provider-neutral and keeps unknown metrics as null.

export type ParsedSocialVideoUrl = {
  platform: 'instagram' | 'tiktok' | 'youtube'
  externalId: string
  canonicalUrl: string
}

const finiteMetric = (value: unknown): number | null => {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[^\d.-]/g, ''))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function cleanSocialMetric(value: unknown): number | null {
  return finiteMetric(value)
}

export function parseSocialVideoUrl(raw: string): ParsedSocialVideoUrl | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  const parts = url.pathname.split('/').filter(Boolean)
  if (host === 'instagram.com' && ['reel', 'reels', 'p'].includes(parts[0]) && parts[1]) {
    return { platform: 'instagram', externalId: parts[1], canonicalUrl: `https://www.instagram.com/reel/${parts[1]}/` }
  }
  if (host === 'tiktok.com' && parts[0]?.startsWith('@') && parts[1] === 'video' && parts[2]) {
    return {
      platform: 'tiktok',
      externalId: parts[2],
      canonicalUrl: `https://www.tiktok.com/${parts[0]}/video/${parts[2]}`,
    }
  }
  if ((host === 'youtube.com' && parts[0] === 'shorts' && parts[1]) || host === 'youtu.be') {
    const id = host === 'youtu.be' ? parts[0] : parts[1]
    return id ? { platform: 'youtube', externalId: id, canonicalUrl: `https://www.youtube.com/shorts/${id}` } : null
  }
  return null
}

export function engagementRate(input: {
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
}): number | null {
  if (input.views == null || input.views <= 0) return null
  const observed = [input.likes, input.comments, input.shares].filter((v): v is number => v != null)
  if (!observed.length) return null
  return (observed.reduce((sum, value) => sum + value, 0) / input.views) * 100
}

export function viewsPerHour(views: number | null, publishedAt: string | null, now = new Date()): number | null {
  if (views == null || !publishedAt) return null
  const elapsed = (now.getTime() - new Date(publishedAt).getTime()) / 3_600_000
  if (!Number.isFinite(elapsed) || elapsed <= 0) return null
  return views / Math.max(elapsed, 0.25)
}

export function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function outlierScore(views: number | null, creatorMedian: number | null): number | null {
  if (views == null || creatorMedian == null || creatorMedian <= 0) return null
  return views / creatorMedian
}

export function isSuspiciousReach(views: number | null, likes: number | null): boolean {
  return views != null && views >= 20_000 && likes != null && (likes / views) * 1_000 < 1.5
}

export type RadarCandidate = {
  id: string
  views_count: number | null
  likes_count: number | null
  published_at: string | null
  username?: string | null
  [key: string]: unknown
}

export function rankRadarPosts<T extends RadarCandidate>(
  posts: T[],
  now = new Date()
): Array<
  T & {
    views_per_hour: number | null
    outlier_score: number | null
    suspicious_reach: boolean
  }
> {
  const byCreator = new Map<string, number[]>()
  for (const post of posts) {
    if (post.username && post.views_count != null) {
      byCreator.set(post.username, [...(byCreator.get(post.username) || []), post.views_count])
    }
  }
  return posts
    .map((post) => {
      const baseline = post.username ? median(byCreator.get(post.username) || []) : null
      return {
        ...post,
        views_per_hour: viewsPerHour(post.views_count, post.published_at, now),
        outlier_score: outlierScore(post.views_count, baseline),
        suspicious_reach: isSuspiciousReach(post.views_count, post.likes_count),
      }
    })
    .sort((a, b) => (b.outlier_score ?? b.views_per_hour ?? -1) - (a.outlier_score ?? a.views_per_hour ?? -1))
}
