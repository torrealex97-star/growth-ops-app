'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Copy, ExternalLink, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTenant } from '@/lib/tenant-context'

export default function CompartirPage() {
  const tenant = useTenant()
  const { id } = useParams<{ id: string }>()
  const [form, setForm] = useState<{ slug: string; status: string } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const ctl = new AbortController()
    fetch(`/api/${tenant}/evergreen/forms/${id}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'No se pudo cargar')
        setForm(j.form)
      })
      .catch((e: Error) => e.name !== 'AbortError' && setError(e.message))
    return () => ctl.abort()
  }, [tenant, id])

  if (error) return <p className="text-sm text-red-500">{error}</p>
  if (!form)
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    )

  const url = `${typeof window === 'undefined' ? '' : window.location.origin}/${tenant}/f/${form.slug}`
  const embed = `<iframe id="form-${form.slug}" src="${url}?embed=1" style="width:100%;min-height:640px;border:0" loading="lazy" title="Formulario"></iframe>\n<script>window.addEventListener('message',function(e){if(e.data&&e.data.type==='form-height'&&e.data.slug==='${form.slug}'){document.getElementById('form-${form.slug}').style.height=e.data.height+'px'}})</script>`
  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    toast.success('Copiado')
  }

  return (
    <div className="max-w-3xl space-y-8">
      {form.status !== 'published' && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-400">
          Este formulario aún no está publicado: el enlace no funcionará hasta que lo publiques desde el Constructor.
        </p>
      )}
      <section className="space-y-2">
        <h2 className="font-semibold text-foreground">Enlace directo</h2>
        <div className="flex gap-2">
          <input
            readOnly
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            value={url}
            aria-label="Enlace"
          />
          <button
            type="button"
            onClick={() => void copy(url)}
            className="rounded-md border border-border px-3 hover:border-brand-500"
            aria-label="Copiar enlace"
          >
            <Copy className="h-4 w-4" />
          </button>
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-md border border-border px-3 hover:border-brand-500"
            aria-label="Abrir"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold text-foreground">Incrustar en tu web</h2>
        <p className="text-sm text-muted-foreground">
          Pega este código donde quieras mostrar el formulario. La altura se ajusta sola.
        </p>
        <textarea
          readOnly
          rows={5}
          className="w-full rounded-md border border-border bg-card p-3 font-mono text-xs"
          value={embed}
          aria-label="Código para incrustar"
        />
        <button
          type="button"
          onClick={() => void copy(embed)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:border-brand-500"
        >
          <Copy className="h-4 w-4" /> Copiar código
        </button>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold text-foreground">Campos ocultos y seguimiento</h2>
        <p className="text-sm text-muted-foreground">
          Añade parámetros al enlace y se guardan con la respuesta:{' '}
          <code className="rounded bg-muted px-1">?utm_source=instagram&amp;utm_campaign=lanzamiento</code>. Para que se
          guarden, añade en el Constructor una pregunta de tipo «Campo oculto» con el mismo nombre de parámetro (por
          ejemplo <code className="rounded bg-muted px-1">profesor</code>).
        </p>
      </section>
    </div>
  )
}
