'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Copy, Loader2, Play, Plus, RotateCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTenant } from '@/lib/tenant-context'
import { formatDateTime } from '@/lib/utils'

interface Hook {
  id: string
  url: string
  active: boolean
  delivered: number
  pending: number
  failed: number
  last: { last_status_code: number | null; last_error: string | null; created_at: string } | null
}

export default function AjustesPage() {
  const tenant = useTenant()
  const { id } = useParams<{ id: string }>()
  const api = `/api/${tenant}/evergreen/forms/${id}/webhooks`
  const [hooks, setHooks] = useState<Hook[] | null>(null)
  const [error, setError] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [secret, setSecret] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await fetch(api)
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return setError(j.error || 'No se pudieron cargar los webhooks')
    setError('')
    setHooks(j.webhooks)
  }, [api])
  useEffect(() => {
    void load()
  }, [load])

  const add = async () => {
    setBusy(true)
    const r = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    const j = await r.json().catch(() => ({}))
    setBusy(false)
    if (!r.ok) return toast.error(j.error || 'No se pudo crear')
    setUrl('')
    setSecret(j.secret)
    void load()
  }
  const act = async (path: string, ok: string) => {
    const r = await fetch(`${api}/${path}`, { method: 'POST' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return toast.error(j.error || 'Error')
    if (path.endsWith('/test'))
      j.ok ? toast.success(`Recibido (HTTP ${j.status})`) : toast.error(`Falló: ${j.error ?? j.status}`)
    else toast.success(ok)
    void load()
  }
  const del = async (wid: string) => {
    if (!window.confirm('¿Eliminar este webhook?')) return
    const r = await fetch(`${api}?wid=${wid}`, { method: 'DELETE' })
    if (!r.ok) return toast.error('No se pudo eliminar')
    void load()
  }

  return (
    <div className="max-w-3xl space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="font-semibold text-foreground">Webhooks de respuestas</h2>
          <p className="text-sm text-muted-foreground">
            Cada respuesta completada se envía por POST (JSON) a estas direcciones, firmada con HMAC-SHA256 en la
            cabecera <code className="rounded bg-muted px-1">X-Form-Signature</code> (
            <code className="rounded bg-muted px-1">t=…,v1=…</code>; calcula HMAC del texto «t.cuerpo» con tu secreto).
            Los fallos se reintentan automáticamente (hasta 5 veces).
          </p>
        </div>
        {secret && (
          <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <p className="text-amber-400">Copia el secreto ahora: no se vuelve a mostrar.</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={secret}
                className="w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-xs"
                aria-label="Secreto"
              />
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(secret)
                  toast.success('Copiado')
                }}
                className="rounded-md border border-border px-3"
                aria-label="Copiar secreto"
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setSecret(null)}
                className="rounded-md border border-border px-3 text-xs"
              >
                Hecho
              </button>
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <input
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
            placeholder="https://tu-servicio.com/webhook"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="URL del webhook"
          />
          <button
            type="button"
            disabled={busy || !url}
            onClick={() => void add()}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Añadir
          </button>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!hooks && !error && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        )}
        {hooks && hooks.length === 0 && <p className="text-sm text-muted-foreground">Aún no hay webhooks.</p>}
        <ul className="space-y-3">
          {hooks?.map((h) => (
            <li key={h.id} className="space-y-2 rounded-xl border border-border p-4">
              <div className="flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate font-mono text-sm">{h.url}</p>
                <button
                  type="button"
                  onClick={() => void act(`${h.id}/test`, '')}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:border-brand-500"
                >
                  <Play className="h-3.5 w-3.5" /> Probar
                </button>
                {h.failed > 0 && (
                  <button
                    type="button"
                    onClick={() => void act(`${h.id}/retry`, 'Reintentos en cola')}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:border-brand-500"
                  >
                    <RotateCw className="h-3.5 w-3.5" /> Reintentar fallidos
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void del(h.id)}
                  className="text-muted-foreground hover:text-red-500"
                  aria-label="Eliminar"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {h.delivered} entregadas · {h.pending} pendientes · {h.failed} fallidas
                {h.last
                  ? ` · última: ${h.last.last_status_code ?? h.last.last_error ?? '—'} (${formatDateTime(h.last.created_at)})`
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
