'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { FormEngine } from '@/components/forms/engine/FormEngine'
import type { FormConfig } from '@/lib/forms/types'

// Formulario PÚBLICO: se rellena sin sesión en /<subcuenta>/f/<slug>. Los parámetros de la URL
// (utm_*, profesor, email…) alimentan los campos ocultos. `?embed=1` avisa a la página anfitriona
// de su altura para que el iframe se ajuste solo.
export default function PublicFormPage() {
  const { tenant, slug } = useParams<{ tenant: string; slug: string }>()
  const [data, setData] = useState<{ name: string; config: FormConfig } | null>(null)
  const [error, setError] = useState('')
  const [hidden, setHidden] = useState<Record<string, string>>({})

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const h: Record<string, string> = {}
    params.forEach((v, k) => {
      if (k !== 'embed' && v.length <= 500) h[k] = v
    })
    setHidden(h)
    fetch(`/api/${tenant}/evergreen/forms/public/${slug}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Formulario no encontrado')
        setData(j)
      })
      .catch((e: Error) => setError(e.message))
  }, [tenant, slug])

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('embed') !== '1') return
    const post = () =>
      window.parent?.postMessage({ type: 'form-height', slug, height: document.documentElement.scrollHeight }, '*')
    const ro = new ResizeObserver(post)
    ro.observe(document.body)
    post()
    return () => ro.disconnect()
  }, [slug, data])

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center text-foreground">
        <p className="text-lg text-muted-foreground">{error}</p>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground" role="status">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }
  return <FormEngine config={data.config} name={data.name} tenant={tenant} slug={slug} hidden={hidden} />
}
