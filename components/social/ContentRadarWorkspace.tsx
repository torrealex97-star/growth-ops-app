'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import {
  AlertTriangle,
  ArrowUpRight,
  Clapperboard,
  Gauge,
  Loader2,
  RefreshCw,
  Sparkles,
  TrendingUp,
  UsersRound,
} from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { formatNumber } from '@/lib/utils'
import { ExternalThumbnail } from '@/components/social/ExternalThumbnail'

const ReelsWorkspace = dynamic(
  () => import('@/components/social/ReelsWorkspace').then((module) => module.ReelsWorkspace),
  {
    loading: () => <div className="dashboard-card h-64 animate-pulse" aria-label="Cargando plan de producción" />,
  }
)

const CompetitorWorkspace = dynamic(
  () => import('@/components/social/CompetitorWorkspace').then((module) => module.CompetitorWorkspace),
  {
    loading: () => (
      <div className="dashboard-card h-64 animate-pulse" aria-label="Cargando biblioteca de competidores" />
    ),
  }
)

export type ContentRadarView = 'oportunidades' | 'competidores' | 'produccion'

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
  health: {
    total: number
    metricsCoverage: number
    status: string
    generatedAt: string
    latestObservedAt: string | null
  }
  automation: {
    enabled: boolean
    configuredTargets: number
    lastRunStatus: string | null
    lastRunAt: string | null
  }
}
const metric = (value: number | null, suffix = '') =>
  value == null ? 'No disponible' : `${formatNumber(value, { notation: 'compact', maximumFractionDigits: 1 })}${suffix}`

export function ContentRadarWorkspace({ initialView }: { initialView: ContentRadarView }) {
  const tenant = useTenant()
  const activeView = initialView
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
    if (activeView === 'oportunidades') void load()
  }, [activeView, load])
  const leader = data?.posts[0]
  const signal = leader?.outlier_score ?? leader?.views_per_hour ?? null

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Gauge className="h-4 w-4 text-primary" /> Inteligencia de contenido
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Radar de contenido</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Detecta qué está despegando y conviértelo en guiones, testimonios y carruseles sin cambiar de herramienta.
          </p>
        </div>
        {activeView === 'oportunidades' && (
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Actualizar lectura
          </button>
        )}
      </header>

      <nav
        aria-label="Flujo de inteligencia de contenido"
        className="grid w-full grid-cols-3 rounded-xl border bg-muted/30 p-1 sm:inline-flex sm:w-auto"
      >
        <Link
          href={`/${tenant}/instagram/radar`}
          aria-current={activeView === 'oportunidades' ? 'page' : undefined}
          className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-none ${
            activeView === 'oportunidades'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <TrendingUp className="h-4 w-4" /> Oportunidades
        </Link>
        <Link
          href={`/${tenant}/instagram/radar?view=competidores`}
          aria-current={activeView === 'competidores' ? 'page' : undefined}
          className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-none sm:px-4 ${
            activeView === 'competidores'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <UsersRound className="h-4 w-4" /> <span className="hidden min-[440px]:inline">Competidores</span>
          <span className="min-[440px]:hidden">Fuentes</span>
        </Link>
        <Link
          href={`/${tenant}/instagram/radar?view=produccion`}
          aria-current={activeView === 'produccion' ? 'page' : undefined}
          className={`flex min-h-10 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:flex-none ${
            activeView === 'produccion'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Clapperboard className="h-4 w-4" /> <span className="hidden sm:inline">Producción</span>
          <span className="sm:hidden">Producir</span>
        </Link>
      </nav>

      {activeView === 'competidores' ? (
        <CompetitorWorkspace />
      ) : activeView === 'produccion' ? (
        <ReelsWorkspace />
      ) : loading && !data ? (
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
                    <span
                      className={`rounded-full px-3 py-1 text-xs ${
                        data.automation.enabled && data.automation.configuredTargets > 0
                          ? 'bg-emerald-500/10 text-emerald-500'
                          : data.automation.enabled
                            ? 'bg-amber-500/10 text-amber-500'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {data.automation.enabled
                        ? data.automation.configuredTargets > 0
                          ? `Radar automático · ${data.automation.configuredTargets} perfiles`
                          : 'Radar automático · faltan perfiles'
                        : 'Radar automático desactivado'}
                    </span>
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
                  <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
                    {data.health.latestObservedAt
                      ? `Datos observados ${new Date(data.health.latestObservedAt).toLocaleString('es-ES')}`
                      : 'Todavía no hay una observación externa disponible'}
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
                      className="grid gap-4 p-4 [content-visibility:auto] [contain-intrinsic-size:116px] transition-colors hover:bg-muted/30 sm:grid-cols-[44px_88px_minmax(0,1fr)_auto] sm:items-center"
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
                          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                  <Link
                    href={`/${tenant}/instagram/investigacion`}
                    className="inline-flex min-h-10 items-center text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    Analizar un reel
                  </Link>
                </div>
              )}
            </section>
          </>
        )
      )}
    </div>
  )
}
