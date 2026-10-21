'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { ResponsesTable } from '@/components/forms/ResponsesTable'

interface F {
  id: string
  name: string
  audience: string
}

const AUDIENCE: Record<string, string> = {
  alumnos: 'Feedback de alumnos y clientes',
  cualificacion: 'Cualificación de clientes',
  captacion: 'Captación',
  empleados: 'Candidaturas de equipo',
}

function RespuestasAlumnos() {
  const tenant = useTenant()
  const router = useRouter()
  const params = useSearchParams()
  const [forms, setForms] = useState<F[] | null>(null)
  const [error, setError] = useState('')
  const formId = params.get('form')

  useEffect(() => {
    const ctl = new AbortController()
    fetch(`/api/${tenant}/evergreen/forms`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'No se pudieron cargar los formularios')
        setForms(j.forms as F[])
      })
      .catch((e: Error) => e.name !== 'AbortError' && setError(e.message))
    return () => ctl.abort()
  }, [tenant])

  if (error) return <p className="text-sm text-red-500">{error}</p>
  if (!forms)
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    )
  if (forms.length === 0)
    return (
      <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No hay formularios todavía.
      </p>
    )
  const current = forms.find((f) => f.id === formId)?.id ?? forms[0].id

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-foreground">Respuestas</h1>
        <select
          className="rounded-md border border-border bg-card px-2 py-1.5 text-sm"
          value={current}
          onChange={(e) => router.replace(`/${tenant}/students/feedback/respuestas?form=${e.target.value}`)}
          aria-label="Formulario"
        >
          {Object.entries(AUDIENCE).map(([aud, label]) => {
            const list = forms.filter((f) => f.audience === aud)
            return list.length ? (
              <optgroup key={aud} label={label}>
                {list.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </optgroup>
            ) : null
          })}
        </select>
      </div>
      <ResponsesTable key={current} formId={current} />
    </div>
  )
}

export default function RespuestasPage() {
  return (
    <Suspense fallback={null}>
      <RespuestasAlumnos />
    </Suspense>
  )
}
