'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Loader2 } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { formatNumber, formatPercent } from '@/lib/utils'
import type { Analytics } from '@/lib/forms/analytics'

const BRAND = 'hsl(var(--brand-500))'
const BRAND_SOFT = 'hsl(var(--brand-500) / 0.35)'
const sel = 'rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground'
const dur = (ms: number | null) =>
  ms === null
    ? '—'
    : ms < 60_000
      ? `${Math.round(ms / 1000)} s`
      : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-2xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-xl border border-border bg-card p-5">
    <h3 className="mb-4 text-sm font-semibold text-foreground">{title}</h3>
    {children}
  </section>
)
const Empty = () => <p className="py-6 text-center text-sm text-muted-foreground">Sin datos todavía</p>

function HBars({ data }: { data: { label: string; count: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const total = data.reduce((a, d) => a + d.count, 0) || 1
  return (
    <ul className="space-y-2">
      {data.map((d) => (
        <li key={d.label} className="text-sm">
          <div className="mb-1 flex justify-between gap-3">
            <span className="truncate text-foreground">{d.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatNumber(d.count)} · {formatPercent((d.count / total) * 100, 0)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full" style={{ width: `${(d.count / max) * 100}%`, background: BRAND }} />
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function AnaliticaPage() {
  const tenant = useTenant()
  const { id } = useParams<{ id: string }>()
  const [days, setDays] = useState('30')
  const [device, setDevice] = useState('')
  const [variant, setVariant] = useState('')
  const [data, setData] = useState<{ analytics: Analytics; truncated: boolean } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const ctl = new AbortController()
    setData(null)
    const p = new URLSearchParams({ days })
    if (device) p.set('device', device)
    if (variant) p.set('variant', variant)
    fetch(`/api/${tenant}/evergreen/forms/${id}/analytics?${p}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'No se pudo calcular la analítica')
        setData(j)
        setError('')
      })
      .catch((e: Error) => e.name !== 'AbortError' && setError(e.message))
    return () => ctl.abort()
  }, [tenant, id, days, device, variant])

  const a = data?.analytics
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <select className={sel} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Periodo">
          <option value="7">Últimos 7 días</option>
          <option value="30">Últimos 30 días</option>
          <option value="90">Últimos 90 días</option>
          <option value="365">Último año</option>
        </select>
        <select className={sel} value={device} onChange={(e) => setDevice(e.target.value)} aria-label="Dispositivo">
          <option value="">Todos los dispositivos</option>
          <option value="mobile">Móvil</option>
          <option value="desktop">Escritorio</option>
        </select>
        <select className={sel} value={variant} onChange={(e) => setVariant(e.target.value)} aria-label="Variante">
          <option value="">Todas las variantes</option>
          <option value="A">Variante A</option>
          <option value="B">Variante B</option>
        </select>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {!a && !error && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Calculando…
        </div>
      )}
      {a && (
        <>
          {data?.truncated && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-400">
              Hay muchos datos: se analizan los más recientes del periodo.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <Kpi label="Visitas" value={formatNumber(a.kpis.views)} />
            <Kpi
              label="Han empezado"
              value={formatNumber(a.kpis.starts)}
              hint={a.kpis.startRate === null ? undefined : formatPercent(a.kpis.startRate * 100, 0)}
            />
            <Kpi
              label="Completadas"
              value={formatNumber(a.kpis.completions)}
              hint={
                a.kpis.completionRate === null
                  ? undefined
                  : `${formatPercent(a.kpis.completionRate * 100, 0)} de visitas`
              }
            />
            <Kpi label="Abandonos" value={formatNumber(a.kpis.abandonments)} />
            <Kpi
              label="Tiempo medio"
              value={dur(a.kpis.avgCompletionMs)}
              hint={`mediana ${dur(a.kpis.medianCompletionMs)}`}
            />
            {a.nps ? (
              <Kpi
                label="NPS"
                value={a.nps.score === null ? '—' : String(a.nps.score)}
                hint={`${formatNumber(a.nps.responses)} respuestas`}
              />
            ) : a.rating ? (
              <Kpi
                label="Valoración media"
                value={(a.rating.average ?? 0).toFixed(1)}
                hint={`${formatNumber(a.rating.responses)} respuestas`}
              />
            ) : (
              <Kpi
                label="Completan tras empezar"
                value={
                  a.kpis.completionRateOfStarts === null ? '—' : formatPercent(a.kpis.completionRateOfStarts * 100, 0)
                }
              />
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Embudo por pregunta">
              {a.funnel.length === 0 || a.funnel[0].reached === 0 ? (
                <Empty />
              ) : (
                <>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={a.funnel.map((f, i) => ({ name: `${i + 1}`, title: f.title, reached: f.reached }))}
                        margin={{ left: -10 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                        <Tooltip
                          formatter={(v) => [formatNumber(Number(v ?? 0)), 'Llegan']}
                          labelFormatter={(_l, p) => p?.[0]?.payload?.title ?? ''}
                        />
                        <Bar dataKey="reached" fill={BRAND} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  {a.biggestDrop && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Mayor caída: antes de «{a.biggestDrop.title}» (−{formatNumber(a.biggestDrop.lost)}).
                    </p>
                  )}
                </>
              )}
            </Card>
            <Card title="Visitas y respuestas por día">
              {a.daily.length === 0 ? (
                <Empty />
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={a.daily} margin={{ left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d: string) => d.slice(5)} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="views"
                        name="Visitas"
                        stroke={BRAND_SOFT}
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="completions"
                        name="Completadas"
                        stroke={BRAND}
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
            <Card title="Fuentes de tráfico">{a.sources.length ? <HBars data={a.sources} /> : <Empty />}</Card>
            <Card title="Dispositivos">
              {Object.keys(a.devices).length ? (
                <HBars
                  data={Object.entries(a.devices).map(([label, count]) => ({
                    label: label === 'mobile' ? 'Móvil' : label === 'desktop' ? 'Escritorio' : 'Desconocido',
                    count,
                  }))}
                />
              ) : (
                <Empty />
              )}
            </Card>
            {a.campaigns.length > 0 && (
              <Card title="Campañas (utm_campaign)">
                <HBars data={a.campaigns} />
              </Card>
            )}
            {a.timePerQuestion.length > 0 && (
              <Card title="Tiempo medio por pregunta">
                <HBars
                  data={a.timePerQuestion
                    .slice(0, 8)
                    .map((t) => ({ label: `${t.title} · ${dur(t.avgMs)}`, count: t.avgMs }))}
                />
              </Card>
            )}
            {a.variants.length > 0 && (
              <Card title="Test A/B">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1 font-medium">Variante</th>
                      <th className="py-1 text-right font-medium">Visitas</th>
                      <th className="py-1 text-right font-medium">Completadas</th>
                      <th className="py-1 text-right font-medium">Conversión</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.variants.map((v) => (
                      <tr key={v.variant} className="border-t border-border/60">
                        <td className="py-2">{v.variant}</td>
                        <td className="py-2 text-right tabular-nums">{formatNumber(v.views)}</td>
                        <td className="py-2 text-right tabular-nums">{formatNumber(v.completions)}</td>
                        <td className="py-2 text-right tabular-nums">
                          {v.rate === null ? '—' : formatPercent(v.rate * 100, 1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
            {Object.keys(a.score.temperatures).length > 0 && (
              <Card
                title={`Temperatura de los leads${a.score.average !== null ? ` · media ${Math.round(a.score.average)}` : ''}`}
              >
                <HBars data={Object.entries(a.score.temperatures).map(([label, count]) => ({ label, count }))} />
              </Card>
            )}
            {a.outcomes.length > 1 && (
              <Card title="Finales alcanzados">
                <HBars data={a.outcomes.map((o) => ({ label: o.id, count: o.count }))} />
              </Card>
            )}
          </div>

          <h2 className="text-sm font-semibold text-foreground">Resumen por pregunta</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {a.questions.map((q) => (
              <Card key={q.id} title={q.title}>
                <p className="-mt-3 mb-3 text-xs text-muted-foreground">{formatNumber(q.answered)} respuestas</p>
                {q.choices && (q.choices.length ? <HBars data={q.choices} /> : <Empty />)}
                {q.rating && (
                  <div>
                    <p className="text-2xl font-bold tabular-nums">
                      {q.rating.average === null ? '—' : q.rating.average.toFixed(2)}
                    </p>
                    <HBars
                      data={Object.entries(q.rating.distribution)
                        .sort((x, y) => Number(y[0]) - Number(x[0]))
                        .map(([label, count]) => ({ label: `${label}`, count }))}
                    />
                  </div>
                )}
                {q.nps && (
                  <div className="space-y-2">
                    <p className="text-2xl font-bold tabular-nums">{q.nps.score ?? '—'}</p>
                    <HBars
                      data={[
                        { label: 'Promotores (9-10)', count: q.nps.promoters },
                        { label: 'Pasivos (7-8)', count: q.nps.passives },
                        { label: 'Detractores (0-6)', count: q.nps.detractors },
                      ]}
                    />
                  </div>
                )}
                {q.texts &&
                  (q.texts.length ? (
                    <ul className="max-h-56 space-y-2 overflow-y-auto text-sm text-foreground">
                      {q.texts.map((t, i) => (
                        <li key={i} className="rounded-md bg-muted/50 p-2">
                          {t}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty />
                  ))}
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
