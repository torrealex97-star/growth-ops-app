'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowUpRight, Gauge, Loader2, RefreshCw, Sparkles, TrendingUp } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { formatNumber } from '@/lib/utils'
import { ExternalThumbnail } from '@/components/social/ExternalThumbnail'

type RadarPost = {
  id: string
  caption: string | null
  post_url: string | null
  thumbnail_url: string | null
  username: string | null
  views_count: number | null
  engagement_rate: number | null
  views_per_hour: number | null
  outlier_score: number | null
  suspicious_reach: boolean
  published_at: string | null
}
type RadarData = {
  windowHours: number
  posts: RadarPost[]
  health: { total: number; metricsCoverage: number; status: string; generatedAt: string }
}
const metric = (value: number | null, suffix = '') =>
  value == null ? 'No disponible' : `${formatNumber(value, { notation: 'compact', maximumFractionDigits: 1 })}${suffix}`

export default function RadarPage() {
  const tenant = useTenant()
  const [data, setData] = useState<RadarData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/${tenant}/evergreen/social/radar`, { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'No se pudo cargar el radar')
      setData(payload)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Error inesperado')
    } finally {
      setLoading(false)
    }
  }, [tenant])
  useEffect(() => {
    void load()
  }, [load])
  const leader = data?.posts[0]
  const signal = leader?.outlier_score ?? leader?.views_per_hour ?? null

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Gauge className="h-4 w-4 text-primary" /> Radar diario
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Qué está despegando en tu nicho</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Ordenado por rendimiento relativo cuando existe historial; por velocidad de visualización cuando todavía no
            hay base suficiente.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Actualizar lectura
        </button>
      </header>
      {loading && !data ? (
        <div className="dashboard-card flex min-h-72 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="flex gap-3 rounded-xl border border-destructive/25 bg-destructive/10 p-4 text-sm">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          {error}
        </div>
      ) : (
        data && (
          <>
            <section className="dashboard-card relative overflow-hidden p-6">
              <div className="absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l from-primary/10 to-transparent" />
              <div className="relative grid gap-6 lg:grid-cols-[1.5fr_0.8fr]">
                <div>
                  <p className="text-xs font-medium uppercase tracking-widest text-primary">
                    Pulso de oportunidad · {data.windowHours} h
                  </p>
                  <h2 className="mt-3 max-w-2xl text-2xl font-semibold">
                    {leader
                      ? leader.caption || `Reel de @${leader.username || 'creador'}`
                      : 'Aún no hay suficiente señal pública'}
                  </h2>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full bg-muted px-3 py-1 text-xs">
                      {data.health.metricsCoverage}% cobertura de métricas
                    </span>
                    <span className="rounded-full bg-muted px-3 py-1 text-xs">{data.health.total} candidatos</span>
                    {leader?.suspicious_reach && (
                      <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs text-amber-500">
                        Alcance atípico · revisar
                      </span>
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border bg-background/70 p-5">
                  <p className="text-xs text-muted-foreground">Señal principal</p>
                  <p className="mt-2 text-4xl font-semibold tabular-nums">
                    {leader?.outlier_score != null ? `${leader.outlier_score.toFixed(1)}×` : metric(signal)}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {leader?.outlier_score != null
                      ? 'sobre la mediana de la muestra del creador'
                      : 'visualizaciones por hora'}
                  </p>
                </div>
              </div>
            </section>
            <section className="dashboard-card p-0">
              <div className="border-b p-5">
                <h2 className="font-semibold">Oportunidades detectadas</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Las cifras son observadas por investigación externa, no métricas oficiales de tu cuenta.
                </p>
              </div>
              {data.posts.length ? (
                <div className="divide-y">
                  {data.posts.map((post, index) => (
                    <article
                      key={post.id}
                      className="grid gap-4 p-4 transition-colors hover:bg-muted/30 sm:grid-cols-[44px_88px_minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-semibold">
                        {index + 1}
                      </div>
                      <div className="aspect-[4/5] overflow-hidden rounded-lg bg-muted">
                        <ExternalThumbnail src={post.thumbnail_url} className="h-full w-full object-cover" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">@{post.username || 'desconocido'}</span>
                          {post.outlier_score != null && post.outlier_score >= 2 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-2xs text-emerald-500">
                              <TrendingUp className="h-3 w-3" /> outlier
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm font-medium">
                          {post.caption || 'Sin caption disponible'}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>{metric(post.views_count)} views</span>
                          <span>{metric(post.views_per_hour)}/h</span>
                          <span>
                            {post.engagement_rate == null
                              ? 'Engagement no disponible'
                              : `${post.engagement_rate.toFixed(2)}% engagement`}
                          </span>
                        </div>
                      </div>
                      {post.post_url && (
                        <a
                          href={post.post_url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Abrir reel"
                          className="rounded-lg border p-2 text-muted-foreground hover:text-foreground"
                        >
                          <ArrowUpRight className="h-4 w-4" />
                        </a>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
                  <Sparkles className="h-8 w-8 text-muted-foreground" />
                  <h3 className="font-semibold">Todavía no hay señal suficiente</h3>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Investiga perfiles o reels públicos para alimentar el radar. Se amplía automáticamente de 24 a 48
                    horas cuando la muestra es pequeña.
                  </p>
                  <a
                    href={`/${tenant}/instagram/investigacion`}
                    className="text-sm font-medium text-primary hover:underline"
                  >
                    Analizar un reel
                  </a>
                </div>
              )}
            </section>
          </>
        )
      )}
    </div>
  )
}
