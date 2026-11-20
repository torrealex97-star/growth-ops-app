'use client'

import { useState } from 'react'
import { ExternalLink, FileText, Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MAX_SOPS_POR_LECCION } from '@/lib/formacion/recurso'

export type Sop = { id: string; lesson_id: string; title: string; url: string; position: number }

/**
 * SOPs de una lección: enlaces a documentos que cuelgan bajo el vídeo. Se abren en pestaña nueva. Quien administra
 * puede añadir más (nombre + enlace) y borrar; el resto solo los ve. Sin SOPs y sin permiso de edición no pinta nada.
 */
export function SopsLista({
  sops,
  puedeEditar,
  onAdd,
  onDelete,
}: {
  sops: Sop[]
  puedeEditar: boolean
  onAdd: (titulo: string, url: string) => Promise<boolean>
  onDelete: (id: string) => Promise<void>
}) {
  const [abierto, setAbierto] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [url, setUrl] = useState('')
  const [guardando, setGuardando] = useState(false)

  if (sops.length === 0 && !puedeEditar) return null

  const guardar = async () => {
    setGuardando(true)
    const ok = await onAdd(titulo, url)
    setGuardando(false)
    if (ok) {
      setTitulo('')
      setUrl('')
      setAbierto(false)
    }
  }

  return (
    <section aria-label="Documentos y SOPs" className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">Documentos y SOPs</h3>
      {sops.length === 0 && <p className="text-sm text-muted-foreground">Esta lección todavía no tiene documentos.</p>}
      <ul className="space-y-2">
        {sops.map((s) => (
          <li key={s.id} className="flex items-center gap-2">
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{s.title}</span>
              <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </a>
            {puedeEditar && (
              <button
                aria-label={`Quitar ${s.title}`}
                className="p-1 text-muted-foreground hover:text-red-400"
                onClick={() => {
                  if (window.confirm(`¿Quitar «${s.title}» de esta lección?`)) void onDelete(s.id)
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>

      {puedeEditar &&
        sops.length < MAX_SOPS_POR_LECCION &&
        (abierto ? (
          <div className="space-y-2 rounded-md border border-border p-3">
            <Input
              value={titulo}
              maxLength={120}
              placeholder="Nombre, p. ej. «SOP de agendamiento»"
              onChange={(e) => setTitulo(e.target.value)}
            />
            <Input value={url} placeholder="https://docs.google.com/…" onChange={(e) => setUrl(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setAbierto(false)}>
                Cancelar
              </Button>
              <Button size="sm" disabled={guardando || !titulo.trim() || !url.trim()} onClick={guardar}>
                Añadir
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" size="sm" className="justify-start" onClick={() => setAbierto(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Añadir SOP
          </Button>
        ))}
    </section>
  )
}
