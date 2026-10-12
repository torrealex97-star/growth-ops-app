'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { useTenant } from '@/lib/tenant-context'
import { formatNumber } from '@/lib/utils'
import { SOURCE_LABEL } from '@/lib/social/types'
import { ExternalThumbnail } from '@/components/social/ExternalThumbnail'

type Job = { id: string; status: string; created_at: string }
type Analysis = { hook: string; estructura: string; tema: string; por_que_funciona: string; tags: string[] }
type Post = {
  id: string
  caption: string | null
  post_url: string | null
  thumbnail_url: string | null
  views_count: number | null
  likes_count: number | null
  comments_count: number | null
  shares_count: number | null
  transcript: string | null
  analysis_json: Analysis | null
  metrics_observed_at: string | null
  collected_at: string
}
const compact = (value: number | null) =>
  value == null ? 'No disponible' : formatNumber(value, { notation: 'compact', maximumFractionDigits: 1 })

export default function AnalyzeReelPage() {
  const tenant = useTenant()
  const [url, setUrl] = useState('')
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [jobs, setJobs] = useState<Job[]>([])
  const [posts, setPosts] = useState<Post[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [analyzingId, setAnalyzingId] = useState<string | null>(null)
  const load = useCallback(async () => {
    const response = await fetch(`/api/${tenant}/evergreen/social/research`, { cache: 'no-store' })
    if (!response.ok) return
    const data = await response.json()
    setEnabled(data.enabled)
    setJobs(data.jobs || [])
    setPosts(data.posts || [])
  }, [tenant])
  useEffect(() => {
    void load()
  }, [load])
  const active = jobs.some((job) => ['pending', 'processing'].includes(job.status))
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(timer)
  }, [active, load])

  const submit = async () => {
    if (!url.trim()) return
    setSubmitting(true)
    try {
      const response = await fetch(`/api/${tenant}/evergreen/social/research`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: 'instagram', jobType: 'reel', url }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'No se pudo analizar el enlace')
      toast.success('Reel recibido. Extraeremos datos y transcripción en segundo plano.')
      setUrl('')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error inesperado')
    } finally {
      setSubmitting(false)
    }
  }
  const analyze = async (postId: string) => {
    setAnalyzingId(postId)
    try {
      const response = await fetch(`/api/${tenant}/evergreen/social/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'No se pudo generar el análisis')
      toast.success('Análisis estratégico completado')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Error inesperado')
    } finally {
      setAnalyzingId(null)
    }
  }
  const latest = useMemo(() => posts.find((post) => post.analysis_json) || posts[0], [posts])

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary" /> Instagram Intelligence
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">¿Por qué funciona este reel?</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Pega un reel público y obtén sus números observados, transcripción, hook, estructura y aprendizajes
          accionables. La investigación pública procede de un proveedor externo; tu cuenta propia usa Meta oficial.
        </p>
      </header>
      <section className="dashboard-card overflow-hidden p-1">
        <div className="flex flex-col gap-3 rounded-[14px] bg-muted/35 p-4 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-xl border bg-background px-4 py-3 focus-within:ring-2 focus-within:ring-primary/30">
            <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
            <input
              aria-label="URL del reel"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void submit()}
              placeholder="https://www.instagram.com/reel/..."
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <button
            onClick={() => void submit()}
            disabled={!url.trim() || submitting || enabled === false}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}{' '}
            Analizar reel
          </button>
        </div>
      </section>
      {enabled === false && (
        <div className="flex gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
          <p>
            Conecta Apify en Integraciones para investigar contenido público. La cuenta propia seguirá usando Meta
            oficial.
          </p>
        </div>
      )}
      {active && (
        <div className="flex items-center gap-3 rounded-xl border bg-card p-4 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span>Extrayendo el reel en segundo plano. Puedes seguir navegando.</span>
        </div>
      )}
      {latest ? (
        <section className="grid gap-6 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.6fr)]">
          <article className="dashboard-card overflow-hidden p-0">
            <div className="aspect-[4/5] overflow-hidden bg-muted">
              <ExternalThumbnail
                src={latest.thumbnail_url}
                alt="Miniatura del reel analizado"
                className="h-full w-full object-cover"
                showLabel
              />
            </div>
            <div className="space-y-3 p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {SOURCE_LABEL.external}
                </span>
                {latest.post_url && (
                  <a
                    href={latest.post_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ArrowUpRight className="h-4 w-4" />
                  </a>
                )}
              </div>
              <p className="line-clamp-3 text-sm">{latest.caption || 'Sin caption disponible'}</p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" /> Observado{' '}
                {new Date(latest.metrics_observed_at || latest.collected_at).toLocaleString('es-ES')}
              </p>
            </div>
          </article>
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                ['Reproducciones', latest.views_count],
                ['Me gusta', latest.likes_count],
                ['Comentarios', latest.comments_count],
                ['Compartidos', latest.shares_count],
              ].map(([label, value]) => (
                <div key={String(label)} className="dashboard-card p-4">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-2 text-xl font-semibold tabular-nums">{compact(value as number | null)}</p>
                </div>
              ))}
            </div>
            {latest.analysis_json ? (
              <div className="dashboard-card space-y-5 p-6">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-primary">Hook detectado</p>
                  <p className="mt-2 text-2xl font-semibold leading-tight">“{latest.analysis_json.hook}”</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Formato y estructura</p>
                    <p className="mt-1 text-sm leading-relaxed">{latest.analysis_json.estructura}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Por qué funciona</p>
                    <p className="mt-1 text-sm leading-relaxed">{latest.analysis_json.por_que_funciona}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {latest.analysis_json.tags.map((tag) => (
                    <span key={tag} className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="dashboard-card flex flex-col items-start gap-4 p-6">
                <div>
                  <h2 className="font-semibold">Datos reales listos</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {latest.transcript
                      ? 'La transcripción está disponible. Genera ahora el análisis estratégico.'
                      : 'No hay transcripción disponible; no inventaremos hook ni formato.'}
                  </p>
                </div>
                <button
                  onClick={() => void analyze(latest.id)}
                  disabled={!latest.transcript || analyzingId === latest.id}
                  className="inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  {analyzingId === latest.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4 text-primary" />
                  )}{' '}
                  Extraer hook y formato
                </button>
              </div>
            )}
            <details className="dashboard-card p-5">
              <summary className="cursor-pointer text-sm font-medium">Ver transcripción</summary>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {latest.transcript || 'Transcripción no disponible.'}
              </p>
            </details>
          </div>
        </section>
      ) : (
        !active && (
          <div className="dashboard-card flex min-h-60 flex-col items-center justify-center gap-3 p-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-muted-foreground" />
            <h2 className="font-semibold">Empieza por un reel público</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Los datos desconocidos aparecerán como “No disponible”, nunca como cero.
            </p>
          </div>
        )
      )}
      {posts.length > 1 && (
        <section className="dashboard-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold">Biblioteca reciente</h2>
            <button
              onClick={() => void load()}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Actualizar
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {posts.slice(0, 9).map((post) => (
              <a
                key={post.id}
                href={post.post_url || '#'}
                target="_blank"
                rel="noreferrer"
                className="rounded-xl border p-4 hover:bg-muted/40"
              >
                <p className="line-clamp-2 text-sm font-medium">
                  {post.analysis_json?.hook || post.caption || 'Reel sin título'}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">{compact(post.views_count)} reproducciones</p>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
