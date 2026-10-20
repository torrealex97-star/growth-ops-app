'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTenant } from '@/lib/tenant-context'
import { FORM_TEMPLATES } from '@/lib/forms/templates'

const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Clientes', keys: ['cualificacion-cliente'] },
  { title: 'Equipo', keys: ['cualificacion-setter', 'cualificacion-closer', 'cualificacion-media-buyer'] },
  { title: 'Alumnos y feedback', keys: ['feedback-clase-directo', 'feedback-modulo', 'nps-cliente'] },
]

export default function PlantillasPage() {
  const tenant = useTenant()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  const use = async (key: string) => {
    setBusy(key)
    const r = await fetch(`/api/${tenant}/evergreen/forms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateKey: key }),
    })
    const j = await r.json().catch(() => ({}))
    setBusy(null)
    if (!r.ok) return toast.error(j.error || 'No se pudo crear el formulario')
    router.push(`/${tenant}/marketing/formularios/${j.id}/constructor`)
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Plantillas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Se copian a tu subcuenta como borrador: edítalas y publícalas cuando quieras.
        </p>
      </div>
      {GROUPS.map((g) => (
        <section key={g.title} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{g.title}</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {g.keys.map((k) => {
              const t = FORM_TEMPLATES.find((x) => x.key === k)
              if (!t) return null
              return (
                <div key={k} className="flex flex-col rounded-xl border border-border bg-card p-5">
                  <h3 className="font-semibold text-foreground">{t.name}</h3>
                  <p className="mt-2 flex-1 text-sm text-muted-foreground">{t.description}</p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {t.config.questions.length} preguntas{t.config.scoring?.enabled ? ' · con puntuación' : ''}
                  </p>
                  <button
                    type="button"
                    onClick={() => void use(k)}
                    disabled={busy !== null}
                    className="mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
                  >
                    {busy === k && <Loader2 className="h-4 w-4 animate-spin" />} Usar plantilla
                  </button>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
