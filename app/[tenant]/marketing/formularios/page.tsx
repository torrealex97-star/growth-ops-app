'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, ClipboardList, Copy, CopyPlus, ExternalLink, Loader2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTenant } from '@/lib/tenant-context'
import { formatNumber, formatPercent } from '@/lib/utils'

interface Row {
  id: string
  slug: string
  name: string
  category: string
  audience: string
  status: 'draft' | 'published' | 'archived'
  responses: number
  sessions: number
  updated_at: string
}

const STATUS: Record<Row['status'], { label: string; cls: string }> = {
  published: { label: 'Publicado', cls: 'bg-emerald-500/15 text-emerald-400' },
  draft: { label: 'Borrador', cls: 'bg-amber-500/15 text-amber-400' },
  archived: { label: 'Archivado', cls: 'bg-muted text-muted-foreground' },
}
const AUDIENCE: Record<string, string> = {
  captacion: 'Captación',
  cualificacion: 'Cualificación',
  empleados: 'Empleados',
  alumnos: 'Alumnos y clientes',
}

export default function FormulariosPage() {
  const tenant = useTenant()
  const router = useRouter()
  const api = `/api/${tenant}/evergreen/forms`
  const [rows, setRows] = useState<Row[] | null>(null)
  const [canWrite, setCanWrite] = useState(false)
  const [canDelete, setCanDelete] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const r = await fetch(api, { signal })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'No se pudieron cargar los formularios')
        setRows(j.forms)
        setCanWrite(!!j.canWrite)
        setCanDelete(!!j.canDelete)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message)
      }
    },
    [api]
  )
  useEffect(() => {
    const ctl = new AbortController()
    void load(ctl.signal)
    return () => ctl.abort()
  }, [load])

  const create = async () => {
    setCreating(true)
    const r = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const j = await r.json().catch(() => ({}))
    setCreating(false)
    if (!r.ok) return toast.error(j.error || 'No se pudo crear')
    router.push(`/${tenant}/marketing/formularios/${j.id}/constructor`)
  }
  const archive = async (id: string, status: 'archived' | 'draft') => {
    const r = await fetch(`${api}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (!r.ok) return toast.error('No se pudo actualizar')
    void load()
  }
  const duplicate = async (id: string) => {
    const r = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cloneFrom: id }),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) return toast.error(j.error || 'No se pudo duplicar')
    toast.success('Duplicado como borrador')
    router.push(`/${tenant}/marketing/formularios/${j.id}/constructor`)
  }
  const remove = async (f: Row) => {
    if (
      !window.confirm(
        `¿Eliminar «${f.name}» y TODAS sus respuestas? Esta acción no se puede deshacer. Si solo quieres ocultarlo, archívalo.`
      )
    )
      return
    const r = await fetch(`${api}/${f.id}`, { method: 'DELETE' })
    if (!r.ok) return toast.error('No se pudo eliminar')
    toast.success('Formulario eliminado')
    void load()
  }
  const copyLink = async (slug: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/${tenant}/f/${slug}`)
    toast.success('Enlace copiado')
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Formularios</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Captación y cualificación de clientes y empleados, y feedback de alumnos.
          </p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Link
              href={`/${tenant}/marketing/formularios/plantillas`}
              className="rounded-md border border-border px-3 py-2 text-sm hover:border-brand-500"
            >
              Desde plantilla
            </Link>
            <button
              type="button"
              onClick={create}
              disabled={creating}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} En blanco
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {!rows && !error && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
        </div>
      )}
      {rows && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-medium text-foreground">Aún no hay formularios</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Empieza con una plantilla: cualificación de clientes, candidaturas o feedback de clases.
          </p>
          <Link
            href={`/${tenant}/marketing/formularios/plantillas`}
            className="mt-4 inline-block rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500"
          >
            Ver plantillas
          </Link>
        </div>
      )}
      {rows && rows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Formulario</th>
                <th className="px-4 py-3 font-medium">Para</th>
                <th className="px-4 py-3 font-medium">Estado</th>
                <th className="px-4 py-3 text-right font-medium">Respuestas</th>
                <th className="px-4 py-3 text-right font-medium">Conversión</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} className="border-b border-border/60 last:border-0 hover:bg-card/50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/${tenant}/marketing/formularios/${f.id}/constructor`}
                      className="font-medium text-foreground hover:text-brand-400"
                    >
                      {f.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">/{f.slug}</p>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{AUDIENCE[f.audience] ?? f.audience}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS[f.status].cls}`}>
                      {STATUS[f.status].label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNumber(f.responses)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {f.sessions > 0 ? formatPercent((f.responses / f.sessions) * 100, 0) : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {f.status === 'published' && (
                        <>
                          <button
                            type="button"
                            onClick={() => void copyLink(f.slug)}
                            className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                            aria-label="Copiar enlace"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          <a
                            href={`/${tenant}/f/${f.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                            aria-label="Abrir formulario"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </>
                      )}
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => void duplicate(f.id)}
                          className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                          aria-label="Duplicar"
                          title="Duplicar"
                        >
                          <CopyPlus className="h-4 w-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => void remove(f)}
                          className="rounded p-1.5 text-muted-foreground hover:text-red-500"
                          aria-label="Eliminar"
                          title="Eliminar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => void archive(f.id, f.status === 'archived' ? 'draft' : 'archived')}
                          className="rounded p-1.5 text-muted-foreground hover:text-foreground"
                          aria-label={f.status === 'archived' ? 'Restaurar' : 'Archivar'}
                        >
                          <Archive className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
