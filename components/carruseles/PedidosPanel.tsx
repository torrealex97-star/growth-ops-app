'use client'

import { useRef, useState } from 'react'
import { Loader2, Paperclip } from 'lucide-react'
import { toast } from 'sonner'
import { TIPOS_PEDIDO, pedidosPendientes } from '@/lib/carruseles/historias/pedidos'
import { useTenant } from '@/lib/tenant-context'
import { subirDirecto } from '@/lib/carruseles/subida-cliente'

interface Props {
  projectId: string
  slides: { id: string; html: string }[]
  onRefresh: () => void
}

/** Material real que las historias piden (capturas de pagos, testimonios, fotos de alumnas…). Al subirlo se compone solo. */
export function PedidosPanel({ projectId, slides, onRefresh }: Props) {
  const tenant = useTenant()
  const [subiendo, setSubiendo] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const claveActiva = useRef<string>('')

  const unicos = [...new Map(pedidosPendientes(slides).map((p) => [p.clave, p])).values()]
  if (unicos.length === 0) return null

  const subir = async (file: File) => {
    const clave = claveActiva.current
    setSubiendo(clave)
    try {
      const { path } = await subirDirecto(tenant, file, 'referencias')
      const res = await fetch(`/api/${tenant}/evergreen/carruseles/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, path, name: file.name, pedido: clave }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error || 'No se pudo subir')
      toast.success('Material subido: la historia se ha actualizado')
      onRefresh()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSubiendo(null)
    }
  }

  return (
    <div className="mx-4 mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <p className="text-xs font-medium text-foreground">
        Falta material real ({unicos.length}) para dar autoridad a las historias
      </p>
      <ul className="mt-2 space-y-2">
        {unicos.map((p) => (
          <li key={p.clave} className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium">{p.titulo}</p>
              <p className="text-3xs text-muted-foreground">{TIPOS_PEDIDO[p.tipo].ayuda}</p>
            </div>
            <button
              onClick={() => {
                claveActiva.current = p.clave
                input.current?.click()
              }}
              disabled={subiendo !== null}
              className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
            >
              {subiendo === p.clave ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
              Subir
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-3xs text-muted-foreground">
        Sube solo imágenes reales y tapa nombres y datos bancarios. Los archivos tienen un enlace no listado, pero no
        son privados.
      </p>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void subir(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
