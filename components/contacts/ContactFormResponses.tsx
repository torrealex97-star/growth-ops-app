'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { formatDateTime } from '@/lib/utils'

interface R {
  id: string
  form_id: string
  form: string
  status: string
  created_at: string
  rating: number | null
  nps: number | null
  score: number | null
  temperature: string | null
  teacher: string | null
  module: string | null
  class_name: string | null
  qa: { q: string; a: string }[]
}

/** Respuestas de formularios de este contacto (feedback, cualificación…), con sus preguntas completas. */
export function ContactFormResponses({ contactId }: { contactId: string }) {
  const tenant = useTenant()
  const [rows, setRows] = useState<R[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const ctl = new AbortController()
    fetch(`/api/${tenant}/evergreen/contacts/${contactId}/form-responses`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'No se pudieron cargar las respuestas')
        setRows(j.responses)
      })
      .catch((e: Error) => e.name !== 'AbortError' && setError(e.message))
    return () => ctl.abort()
  }, [tenant, contactId])

  if (error) return <p className="text-sm text-red-500">{error}</p>
  if (!rows)
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    )
  if (rows.length === 0)
    return (
      <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Este contacto no tiene respuestas de formularios.
      </p>
    )
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.id} className="dashboard-card space-y-3 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              href={`/${tenant}/students/feedback/respuestas?form=${r.form_id}`}
              className="font-medium hover:underline"
            >
              {r.form}
            </Link>
            <span className="text-muted-foreground">{formatDateTime(r.created_at)}</span>
            {r.status === 'partial' && <span className="rounded bg-muted px-1.5 py-0.5 text-2xs">parcial</span>}
            {r.rating !== null && <span className="tabular-nums">{r.rating}/5</span>}
            {r.nps !== null && <span className="tabular-nums">NPS {r.nps}</span>}
            {r.temperature && (
              <span>
                {r.temperature} · {r.score}
              </span>
            )}
            {[r.module, r.teacher, r.class_name].filter(Boolean).length > 0 && (
              <span className="text-muted-foreground">
                {[r.module, r.teacher, r.class_name].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
          <dl className="space-y-2">
            {r.qa.map((x) => (
              <div key={x.q}>
                <dt className="text-xs text-muted-foreground">{x.q}</dt>
                <dd className="whitespace-pre-wrap">{x.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}
