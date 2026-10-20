'use client'

import { useState } from 'react'
import { Loader2, TrendingDown, TrendingUp } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { cn, formatNumber } from '@/lib/utils'
import { useFeedback } from '@/components/forms/useFeedback'
import type { Group } from '@/lib/forms/feedback'

const sel = 'rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground'

function Ranking({ title, rows }: { title: string; rows: Group[] }) {
  if (rows.length === 0) return null
  return (
    <section className="overflow-x-auto rounded-xl border border-border bg-card">
      <h2 className="px-5 pt-4 text-sm font-semibold text-foreground">{title}</h2>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-5 py-2 font-medium">Nombre</th>
            <th className="px-5 py-2 text-right font-medium">Respuestas</th>
            <th className="px-5 py-2 text-right font-medium">Media</th>
            <th className="px-5 py-2 text-right font-medium">NPS</th>
            <th className="px-5 py-2 text-right font-medium">Bajas (&lt;4)</th>
            <th className="px-5 py-2 text-right font-medium">Tendencia</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.label} className="border-b border-border/60 last:border-0">
              <td className="px-5 py-2.5 text-foreground">{g.label}</td>
              <td className="px-5 py-2.5 text-right tabular-nums">{formatNumber(g.responses)}</td>
              <td
                className={cn(
                  'px-5 py-2.5 text-right font-medium tabular-nums',
                  g.average !== null && g.average < 4 ? 'text-red-400' : 'text-foreground'
                )}
              >
                {g.average === null ? '—' : g.average.toFixed(2)}
              </td>
              <td
                className="px-5 py-2.5 text-right tabular-nums"
                title={`${formatNumber(g.npsResponses)} respuestas de NPS`}
              >
                {g.npsScore === null ? '—' : g.npsScore}
              </td>
              <td className="px-5 py-2.5 text-right tabular-nums text-muted-foreground">{g.low}</td>
              <td className="px-5 py-2.5 text-right tabular-nums">
                {g.trend === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1',
                      g.trend < -0.2 ? 'text-red-400' : g.trend > 0.2 ? 'text-emerald-400' : 'text-muted-foreground'
                    )}
                  >
                    {g.trend < -0.2 ? (
                      <TrendingDown className="h-3.5 w-3.5" />
                    ) : g.trend > 0.2 ? (
                      <TrendingUp className="h-3.5 w-3.5" />
                    ) : null}
                    {g.trend > 0 ? '+' : ''}
                    {g.trend.toFixed(2)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-5 pb-3 pt-1 text-2xs text-muted-foreground">
        Tendencia: media de las últimas 4 semanas frente a las 4 anteriores.
      </p>
    </section>
  )
}

export default function ProfesoresPage() {
  const tenant = useTenant()
  const [days, setDays] = useState('90')
  const { data, error } = useFeedback(tenant, days)
  const s = data?.summary

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard de profesores</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Estrellas por profesor, módulo y clase, y qué dicen quienes valoran con menos de 4.
          </p>
        </div>
        <select className={sel} value={days} onChange={(e) => setDays(e.target.value)} aria-label="Periodo">
          <option value="30">Últimos 30 días</option>
          <option value="90">Últimos 90 días</option>
          <option value="365">Último año</option>
        </select>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!data && !error && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      )}
      {s && s.teachers.length + s.modules.length + s.classes.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Todavía no hay valoraciones con profesor, módulo o clase. Aparecerán aquí cuando respondan a los formularios
          de feedback.
        </p>
      )}
      {s && (
        <>
          <Ranking title="Profesores" rows={s.teachers} />
          <Ranking title="Módulos" rows={s.modules} />
          <Ranking title="Clases" rows={s.classes} />
          {s.lowComments.length > 0 && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Qué mejorar (valoraciones de menos de 4)</h2>
              <ul className="space-y-3">
                {s.lowComments.map((c, i) => (
                  <li key={i} className="rounded-lg bg-muted/50 p-3 text-sm">
                    <p className="mb-1 text-xs text-muted-foreground">
                      {[c.teacher, c.module, c.class].filter(Boolean).join(' · ') || 'Sin clasificar'} · {c.rating}/5 ·{' '}
                      {c.at.slice(0, 10)}
                    </p>
                    <p className="whitespace-pre-wrap text-foreground">{c.comment}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
