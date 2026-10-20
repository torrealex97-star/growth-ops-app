'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { formatNumber, formatPercent } from '@/lib/utils'
import { useFeedback } from '@/components/forms/useFeedback'

const sel = 'rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground'
const Kpi = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="rounded-xl border border-border bg-card p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
    {hint && <p className="mt-0.5 text-2xs text-muted-foreground">{hint}</p>}
  </div>
)

export default function FeedbackResumenPage() {
  const tenant = useTenant()
  const [days, setDays] = useState('90')
  const { data, error } = useFeedback(tenant, days)
  const s = data?.summary

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Feedback de alumnos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Valoraciones de clases en directo, módulos y NPS, de todos tus formularios de feedback.
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
      {data && data.forms.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Aún no hay formularios de feedback. Crea uno desde una plantilla en Marketing › Formularios › Plantillas
          («Feedback de clases en directo», «Feedback de módulos» o «NPS»).
        </p>
      )}
      {s && data && data.forms.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi
              label="Respuestas"
              value={formatNumber(s.responses)}
              hint={`${formatNumber(s.linked)} vinculadas a un alumno`}
            />
            <Kpi
              label="Valoración media"
              value={s.rating.average === null ? '—' : s.rating.average.toFixed(2)}
              hint={`${formatNumber(s.rating.responses)} valoraciones`}
            />
            <Kpi
              label="NPS"
              value={s.nps.score === null ? '—' : String(s.nps.score)}
              hint={`${formatNumber(s.nps.responses)} respuestas`}
            />
            <Kpi
              label="Valoraciones bajas"
              value={
                s.rating.responses
                  ? formatPercent(
                      (Object.entries(s.rating.distribution)
                        .filter(([k]) => Number(k) < 4)
                        .reduce((a, [, v]) => a + v, 0) /
                        s.rating.responses) *
                        100,
                      0
                    )
                  : '—'
              }
              hint="menos de 4 estrellas"
            />
          </div>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Formulario</th>
                  <th className="px-4 py-3 text-right font-medium">Respuestas</th>
                  <th className="px-4 py-3 text-right font-medium">Media</th>
                  <th className="px-4 py-3 text-right font-medium">NPS</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.forms.map((f) => (
                  <tr key={f.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-3 text-foreground">
                      {f.name}
                      {f.status !== 'published' && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground">
                          borrador
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNumber(f.responses)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {f.average === null ? '—' : f.average.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{f.nps ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/${tenant}/students/feedback/respuestas?form=${f.id}`}
                        className="text-brand-400 hover:underline"
                      >
                        Ver respuestas
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {s.weekly.length > 1 && (
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-3 text-sm font-semibold text-foreground">Valoración media por semana</h2>
              <ul className="space-y-2">
                {s.weekly.map((w) => (
                  <li key={w.week} className="flex items-center gap-3 text-sm">
                    <span className="w-24 shrink-0 text-muted-foreground">{w.week.slice(5)}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${((w.average ?? 0) / 5) * 100}%`, background: 'hsl(var(--brand-500))' }}
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right tabular-nums text-foreground">
                      {w.average === null ? '—' : w.average.toFixed(2)}{' '}
                      <span className="text-muted-foreground">({w.responses})</span>
                    </span>
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
