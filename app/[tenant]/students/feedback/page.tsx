'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { formatNumber, formatPercent } from '@/lib/utils'
import { useFeedback, type RespuestaSinFicha } from '@/components/forms/useFeedback'

const sel = 'rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground'
const Kpi = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <div className="dashboard-card p-4">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
    {hint && <p className="mt-0.5 text-2xs text-muted-foreground">{hint}</p>}
  </div>
)

type Contacto = { id: string; full_name: string | null; email: string | null }

// Vincular una respuesta huérfana con su ficha. Se busca por nombre o email (NUNCA se enlaza sola:
// decide una persona) y el PATCH valida que el contacto sea de esta subcuenta.
function AsignarFicha({
  tenantSlug,
  respuesta,
  onClose,
  onVinculada,
}: {
  tenantSlug: string
  respuesta: RespuestaSinFicha
  onClose: () => void
  onVinculada: () => void
}) {
  const [texto, setTexto] = useState(respuesta.email ?? '')
  const [resultados, setResultados] = useState<Contacto[]>([])
  const [buscando, setBuscando] = useState(false)
  const [guardando, setGuardando] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const consulta = texto.trim()
    // Un error de una búsqueda anterior no vale para la siguiente.
    setError('')
    if (consulta.length < 2) {
      setResultados([])
      setBuscando(false)
      return
    }
    const ctl = new AbortController()
    setBuscando(true)
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/${tenantSlug}/evergreen/forms/feedback/contactos?q=${encodeURIComponent(consulta)}`,
          { signal: ctl.signal }
        )
        const j = await r.json().catch(() => ({}))
        if (ctl.signal.aborted) return
        setBuscando(false)
        if (!r.ok) {
          setError(j.error || 'No se pudieron buscar fichas')
          return
        }
        setResultados((j.contactos ?? []) as Contacto[])
      } catch (e) {
        if (ctl.signal.aborted) return
        setBuscando(false)
        setError(e instanceof Error ? e.message : 'No se pudieron buscar fichas')
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      ctl.abort()
    }
  }, [texto, tenantSlug])

  const vincular = async (contactId: string) => {
    setGuardando(contactId)
    setError('')
    const r = await fetch(`/api/${tenantSlug}/evergreen/forms/${respuesta.form_id}/responses/${respuesta.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: contactId }),
    })
    const j = await r.json().catch(() => ({}))
    setGuardando('')
    if (!r.ok) {
      setError(j.error || 'No se pudo vincular')
      return
    }
    onVinculada()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Vincular respuesta con una ficha"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Vincular con una ficha</h2>
            <p className="mt-0.5 text-2xs text-muted-foreground">
              {respuesta.form_name} ·{' '}
              {new Date(respuesta.created_at).toLocaleDateString('es-ES', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
            Cerrar
          </button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {respuesta.email
            ? 'La respuesta trae este email. Busca su ficha o escribe otro nombre o correo.'
            : 'Esta respuesta no llegó a pedir el email. Busca la ficha por nombre o correo.'}
        </p>
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Nombre o email"
          autoFocus
          className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          aria-label="Buscar contacto"
        />
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        <div className="mt-3 max-h-64 overflow-y-auto">
          {buscando && (
            <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Buscando…
            </p>
          )}
          {!buscando && texto.trim().length >= 2 && resultados.length === 0 && (
            <p className="py-2 text-xs text-muted-foreground">Ninguna ficha coincide.</p>
          )}
          {resultados.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => vincular(c.id)}
              disabled={Boolean(guardando)}
              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
            >
              <span className="text-foreground">{c.full_name || 'Sin nombre'}</span>
              <span className="text-xs text-muted-foreground">
                {guardando === c.id ? 'Vinculando…' : c.email || '—'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function FeedbackResumenPage() {
  const tenant = useTenant()
  const [days, setDays] = useState('90')
  const [asignar, setAsignar] = useState<RespuestaSinFicha | null>(null)
  const { data, error, recargar } = useFeedback(tenant, days)
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
      {asignar && (
        <AsignarFicha
          tenantSlug={tenant}
          respuesta={asignar}
          onClose={() => setAsignar(null)}
          onVinculada={() => {
            setAsignar(null)
            recargar()
          }}
        />
      )}
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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
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
            <Kpi
              label="Sin ficha"
              value={data.sinFicha.error ? '—' : formatNumber(data.sinFicha.total)}
              hint={
                data.sinFicha.error
                  ? 'no se pudo leer'
                  : data.sinFicha.total === 0
                    ? 'todo vinculado'
                    : 'pendientes, todas las fechas'
              }
            />
          </div>
          {(data.sinFicha.error || data.sinFicha.total > 0) && (
            <section className="dashboard-card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  Respuestas sin ficha{' '}
                  {!data.sinFicha.error && (
                    <span className="ml-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-2xs font-medium text-amber-500">
                      {formatNumber(data.sinFicha.total)}
                    </span>
                  )}
                </h2>
                <p className="text-2xs text-muted-foreground">
                  Cola de revisión, sin filtro de periodo: una respuesta sin vincular no caduca.
                </p>
              </div>
              {data.sinFicha.error && (
                <div className="mt-3 flex items-center gap-3 text-sm text-muted-foreground">
                  <span>{data.sinFicha.error}</span>
                  <button type="button" onClick={recargar} className="text-brand-400 hover:underline">
                    Reintentar
                  </button>
                </div>
              )}
              {!data.sinFicha.error && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="px-2 py-2 font-medium">Fecha</th>
                        <th className="px-2 py-2 font-medium">Formulario</th>
                        <th className="px-2 py-2 font-medium">Email</th>
                        <th className="px-2 py-2 text-right font-medium">Valoración</th>
                        <th className="px-2 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {data.sinFicha.rows.map((r) => (
                        <tr key={r.id} className="border-b border-border/60 last:border-0">
                          <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                            {new Date(r.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })}
                          </td>
                          <td className="px-2 py-2 text-foreground">{r.form_name}</td>
                          <td className="px-2 py-2">
                            {r.email ? (
                              <span className="text-foreground">{r.email}</span>
                            ) : (
                              <span className="text-muted-foreground">sin email</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-foreground">
                            {r.rating !== null ? `${r.rating} / 5` : r.nps !== null ? `NPS ${r.nps}` : '—'}
                          </td>
                          <td className="px-2 py-2 text-right">
                            {data.sinFicha.canAssign ? (
                              <button
                                type="button"
                                onClick={() => setAsignar(r)}
                                className="text-brand-400 hover:underline"
                              >
                                Asignar
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!data.sinFicha.error && data.sinFicha.truncated && (
                <p className="mt-2 text-2xs text-muted-foreground">Se muestran las 50 más recientes.</p>
              )}
            </section>
          )}
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
            <section className="dashboard-card p-5">
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
