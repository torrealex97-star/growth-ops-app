'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ChevronLeft, ChevronRight, Download, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTenant } from '@/lib/tenant-context'
import { cn, formatDateTime, formatNumber } from '@/lib/utils'
import { REVIEW_STATUSES } from '@/lib/forms/types'

interface Resp {
  id: string
  status: 'partial' | 'completed'
  answers: Record<string, unknown>
  hidden: Record<string, string>
  score: number | null
  temperature: 'caliente' | 'templado' | 'frio' | null
  rating: number | null
  nps: number | null
  teacher: string | null
  outcome: string | null
  variant: string | null
  review_status: string
  review_notes: string | null
  duration_ms: number | null
  created_at: string
}
interface Q {
  id: string
  title: string
  type: string
  options: { value: string; label: string }[] | null
}

const REVIEW_LABEL: Record<string, string> = {
  nuevo: 'Nuevo',
  contactado: 'Contactado',
  entrevista: 'Entrevista',
  descartado: 'Descartado',
  contratado: 'Contratado',
}
const TEMP_CLS: Record<string, string> = {
  caliente: 'bg-red-500/15 text-red-400',
  templado: 'bg-amber-500/15 text-amber-400',
  frio: 'bg-sky-500/15 text-sky-400',
}
const sel = 'rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground'

function show(q: Q, v: unknown): string {
  const one = (x: unknown) =>
    typeof x === 'string'
      ? (q.options?.find((o) => o.value === x)?.label ?? x.replace(/^other:/, 'Otro: '))
      : x === true
        ? 'Sí'
        : String(x)
  if (v === undefined || v === null || v === '') return '—'
  if (q.type === 'yesNo') return v === 'yes' ? 'Sí' : 'No'
  return Array.isArray(v) ? v.map(one).join(', ') : one(v)
}

export default function RespuestasPage() {
  const tenant = useTenant()
  const { id } = useParams<{ id: string }>()
  const base = `/api/${tenant}/evergreen/forms/${id}/responses`
  const [rows, setRows] = useState<Resp[] | null>(null)
  const [questions, setQuestions] = useState<Q[]>([])
  const [total, setTotal] = useState(0)
  const [pageSize, setPageSize] = useState(50)
  const [page, setPage] = useState(0)
  const [filters, setFilters] = useState({ status: '', temperature: '', review: '' })
  const [canWrite, setCanWrite] = useState(false)
  const [canDelete, setCanDelete] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Resp | null>(null)
  const [notes, setNotes] = useState('')

  const qs = useCallback(
    (extra: Record<string, string> = {}) => {
      const p = new URLSearchParams()
      for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v) p.set(k, v)
      return p.toString()
    },
    [filters]
  )

  useEffect(() => {
    const ctl = new AbortController()
    setRows(null)
    fetch(`${base}?${qs({ page: String(page) })}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'No se pudieron cargar las respuestas')
        setRows(j.responses)
        setQuestions(j.questions)
        setTotal(j.total)
        setPageSize(j.pageSize)
        setCanWrite(j.canWrite)
        setCanDelete(j.canDelete)
        setError('')
      })
      .catch((e: Error) => e.name !== 'AbortError' && setError(e.message))
    return () => ctl.abort()
  }, [base, qs, page])

  const review = async (r: Resp, patch: { review_status?: string; review_notes?: string | null }) => {
    const res = await fetch(`${base}/${r.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) return toast.error('No se pudo actualizar')
    const upd = { ...r, ...patch } as Resp
    setRows((cur) => cur && cur.map((x) => (x.id === r.id ? upd : x)))
    setOpen((o) => (o && o.id === r.id ? upd : o))
  }
  const remove = async (r: Resp) => {
    if (!window.confirm('¿Eliminar esta respuesta de forma permanente?')) return
    const res = await fetch(`${base}/${r.id}`, { method: 'DELETE' })
    if (!res.ok) return toast.error('No se pudo eliminar')
    setRows((cur) => cur && cur.filter((x) => x.id !== r.id))
    setTotal((t) => t - 1)
    setOpen(null)
  }

  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={sel}
          value={filters.status}
          onChange={(e) => {
            setPage(0)
            setFilters({ ...filters, status: e.target.value })
          }}
          aria-label="Estado"
        >
          <option value="">Todas</option>
          <option value="completed">Completadas</option>
          <option value="partial">Parciales (abandonadas)</option>
        </select>
        <select
          className={sel}
          value={filters.temperature}
          onChange={(e) => {
            setPage(0)
            setFilters({ ...filters, temperature: e.target.value })
          }}
          aria-label="Temperatura"
        >
          <option value="">Cualquier temperatura</option>
          <option value="caliente">Caliente</option>
          <option value="templado">Templado</option>
          <option value="frio">Frío</option>
        </select>
        <select
          className={sel}
          value={filters.review}
          onChange={(e) => {
            setPage(0)
            setFilters({ ...filters, review: e.target.value })
          }}
          aria-label="Revisión"
        >
          <option value="">Cualquier revisión</option>
          {REVIEW_STATUSES.map((s) => (
            <option key={s} value={s}>
              {REVIEW_LABEL[s]}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">{formatNumber(total)} respuestas</span>
        <a
          href={`${base}?${qs({ format: 'csv' })}`}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:border-brand-500"
        >
          <Download className="h-4 w-4" /> Exportar CSV
        </a>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {!rows && !error && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      )}
      {rows && rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          Aún no hay respuestas con estos filtros.
        </p>
      )}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Fecha</th>
                {questions.slice(0, 2).map((q) => (
                  <th key={q.id} className="px-4 py-3 font-medium">
                    {q.title}
                  </th>
                ))}
                <th className="px-4 py-3 font-medium">Resultado</th>
                <th className="px-4 py-3 font-medium">Revisión</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => {
                    setOpen(r)
                    setNotes(r.review_notes ?? '')
                  }}
                  className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-card/50"
                >
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {formatDateTime(r.created_at)}
                    {r.status === 'partial' && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-2xs">parcial</span>
                    )}
                  </td>
                  {questions.slice(0, 2).map((q) => (
                    <td key={q.id} className="max-w-[220px] truncate px-4 py-3">
                      {show(q, r.answers?.[q.id])}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      {r.temperature && (
                        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', TEMP_CLS[r.temperature])}>
                          {r.temperature} · {r.score}
                        </span>
                      )}
                      {r.rating !== null && <span className="tabular-nums">{r.rating}/5</span>}
                      {r.nps !== null && <span className="tabular-nums">NPS {r.nps}</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {REVIEW_LABEL[r.review_status] ?? r.review_status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="rounded border border-border p-1.5 disabled:opacity-30"
            aria-label="Anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span>
            Página {page + 1} de {pages}
          </span>
          <button
            type="button"
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-border p-1.5 disabled:opacity-30"
            aria-label="Siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Respuesta</DialogTitle>
          </DialogHeader>
          {open && (
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                {formatDateTime(open.created_at)}
                {open.duration_ms ? ` · ${Math.round(open.duration_ms / 1000)} s` : ''}
                {open.variant ? ` · variante ${open.variant}` : ''}
              </p>
              <dl className="space-y-3">
                {questions.map((q) => (
                  <div key={q.id}>
                    <dt className="text-xs text-muted-foreground">{q.title}</dt>
                    <dd className="whitespace-pre-wrap text-foreground">{show(q, open.answers?.[q.id])}</dd>
                  </div>
                ))}
                {Object.keys(open.hidden ?? {}).length > 0 && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Parámetros de la URL</dt>
                    <dd className="text-foreground">
                      {Object.entries(open.hidden)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(' · ')}
                    </dd>
                  </div>
                )}
              </dl>
              {canWrite && (
                <div className="space-y-2 border-t border-border pt-3">
                  <select
                    className={sel}
                    value={open.review_status}
                    onChange={(e) => void review(open, { review_status: e.target.value })}
                    aria-label="Estado de revisión"
                  >
                    {REVIEW_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {REVIEW_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <textarea
                    className="w-full resize-none rounded-md border border-border bg-card p-2"
                    rows={3}
                    maxLength={2000}
                    placeholder="Notas internas"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={() =>
                      notes !== (open.review_notes ?? '') && void review(open, { review_notes: notes || null })
                    }
                  />
                </div>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => void remove(open)}
                  className="inline-flex items-center gap-1.5 text-red-500 hover:underline"
                >
                  <Trash2 className="h-4 w-4" /> Eliminar respuesta
                </button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
