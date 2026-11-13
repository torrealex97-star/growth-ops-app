'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTenant } from '@/lib/tenant-context'
import { formatNumber } from '@/lib/utils'
import type { FieldType, FormAudience, FormCategory, FormConfig } from '@/lib/forms/types'

// Vista previa de un formulario PROPUESTO (por la IA o por un importador) antes de crearlo. Crear lo guarda
// como BORRADOR y abre el constructor: nada se publica desde aquí.

export type Propuesta = {
  name: string
  category: FormCategory
  audience: FormAudience
  config: FormConfig
  avisos?: string[]
}

const TIPO: Record<FieldType, string> = {
  shortText: 'Texto corto',
  longText: 'Texto largo',
  email: 'Email',
  phone: 'Teléfono',
  number: 'Número',
  url: 'Enlace',
  date: 'Fecha',
  singleChoice: 'Una opción',
  multiChoice: 'Varias opciones',
  yesNo: 'Sí / No',
  dropdown: 'Desplegable',
  rating: 'Estrellas',
  nps: 'NPS 0-10',
  scale: 'Escala',
  statement: 'Texto informativo',
  consent: 'Consentimiento',
  booking: 'Agenda',
  hidden: 'Campo oculto',
}

export function PropuestaFormulario({
  propuesta,
  onNombre,
  pie,
}: {
  propuesta: Propuesta
  /** Si se pasa, el nombre interno se puede editar antes de crear. */
  onNombre?: (nombre: string) => void
  pie?: string
}) {
  const tenant = useTenant()
  const router = useRouter()
  const [creando, setCreando] = useState(false)
  const { config } = propuesta
  const avisos = propuesta.avisos ?? []

  const crear = async () => {
    if (!propuesta.name.trim()) return toast.error('Ponle un nombre al formulario')
    setCreando(true)
    const r = await fetch(`/api/${tenant}/evergreen/forms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: propuesta.name.trim(),
        category: propuesta.category,
        audience: propuesta.audience,
        config,
      }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) {
      setCreando(false)
      return toast.error(j.error || 'No se pudo crear el formulario')
    }
    toast.success('Creado como borrador')
    router.push(`/${tenant}/marketing/formularios/${j.id}/constructor`)
  }

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div className="space-y-1">
        <label htmlFor="propuesta-nombre" className="text-xs font-medium text-muted-foreground">
          Nombre interno
        </label>
        <input
          id="propuesta-nombre"
          value={propuesta.name}
          onChange={(e) => onNombre?.(e.target.value)}
          readOnly={!onNombre}
          maxLength={160}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground focus:border-brand-500 focus:outline-none"
        />
      </div>

      {config.welcome && (
        <div className="rounded-lg bg-muted/50 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Bienvenida</p>
          <p className="mt-1 text-sm font-medium text-foreground">{config.welcome.title}</p>
          {config.welcome.subtitle && <p className="text-sm text-muted-foreground">{config.welcome.subtitle}</p>}
        </div>
      )}

      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {formatNumber(config.questions.length)} {config.questions.length === 1 ? 'pregunta' : 'preguntas'}
          {config.scoring?.enabled ? ' · con puntuación' : ''}
          {config.logic.length > 0 ? ` · ${formatNumber(config.logic.length)} reglas de salto` : ''}
        </p>
        <ol className="mt-2 space-y-2">
          {config.questions.map((q, i) => (
            <li key={q.id} className="rounded-lg border border-border/70 px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-sm text-foreground">
                  <span className="mr-1.5 tabular-nums text-muted-foreground">{i + 1}.</span>
                  {q.title}
                  {q.required && <span className="ml-1 text-xs text-muted-foreground">(obligatoria)</span>}
                </p>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                  {TIPO[q.type]}
                  {q.showIf ? ' · condicional' : ''}
                </span>
              </div>
              {q.options && q.options.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {q.options.map((o) => o.label).join(' · ')}
                  {q.allowOther ? ' · Otro' : ''}
                </p>
              )}
            </li>
          ))}
        </ol>
      </div>

      <div>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {config.endings.length === 1 ? 'Final' : 'Finales'}
        </p>
        <ul className="mt-2 space-y-1">
          {config.endings.map((e) => (
            <li key={e.id} className="text-sm text-foreground">
              {e.title}
              {e.message && <span className="text-muted-foreground"> — {e.message}</span>}
              {e.when && <span className="ml-1 text-xs text-muted-foreground">(condicional)</span>}
            </li>
          ))}
        </ul>
      </div>

      {avisos.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
            <AlertTriangle className="h-3.5 w-3.5" /> Revisa esto antes de publicar
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-xs text-amber-300">
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">
          {pie ?? 'Se crea como borrador: lo editas en el constructor y lo publicas cuando quieras.'}
        </p>
        <button
          type="button"
          onClick={() => void crear()}
          disabled={creando}
          className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
        >
          {creando && <Loader2 className="h-4 w-4 animate-spin" />} Crear formulario
        </button>
      </div>
    </div>
  )
}
