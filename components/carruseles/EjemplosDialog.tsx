'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Sparkles, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTenant } from '@/lib/tenant-context'
import { MAX_EJEMPLOS_POR_TIPO, type EjemplosTenant, type TipoEjemplo } from '@/lib/carruseles/ejemplos'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
  tipoInicial?: TipoEjemplo
  /** Se avisa al cambiar ejemplos o guía, para que quien abrió el diálogo refresque su contador. */
  onCambio?: () => void
}

const NOMBRE: Record<TipoEjemplo, string> = { historias: 'Historias', carrusel: 'Carruseles' }

/** Ejemplos de historias y carruseles del tenant. La app los analiza y genera siendo fiel a su diseño. */
export function EjemplosDialog({ open, onOpenChange, tipoInicial = 'historias', onCambio }: Props) {
  const tenant = useTenant()
  const [tipo, setTipo] = useState<TipoEjemplo>(tipoInicial)
  const [datos, setDatos] = useState<(EjemplosTenant & { puedeEditar?: boolean }) | null>(null)
  const [guia, setGuia] = useState('')
  const [ocupado, setOcupado] = useState<null | 'subiendo' | 'analizando' | 'guardando'>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const base = `/api/${tenant}/evergreen/carruseles/ejemplos`

  const cargar = useCallback(async () => {
    const r = await fetch(base)
    if (r.ok) setDatos((await r.json()) as EjemplosTenant & { puedeEditar?: boolean })
  }, [base])

  useEffect(() => {
    if (open) {
      setTipo(tipoInicial)
      void cargar()
    }
  }, [open, tipoInicial, cargar])

  useEffect(() => {
    setGuia(datos?.guia[tipo] ?? '')
  }, [datos, tipo])

  const aplicar = async (r: Response, ok: string) => {
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error((j as { error?: string }).error || 'No se pudo completar')
    setDatos((d) => ({ ...(d as object), ...(j as EjemplosTenant) }) as typeof datos)
    onCambio?.()
    if (ok) toast.success(ok)
  }

  const subir = async (files: FileList) => {
    setOcupado('subiendo')
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('tipo', tipo)
        await aplicar(await fetch(base, { method: 'POST', body: fd }), '')
      }
      toast.success('Ejemplos subidos. Pulsa «Analizar» para que la app aprenda su estilo.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  const accion = async (nombre: 'analizando' | 'guardando', f: () => Promise<void>) => {
    setOcupado(nombre)
    try {
      await f()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOcupado(null)
    }
  }

  const delTipo = (datos?.ejemplos ?? []).filter((e) => e.tipo === tipo)
  const puedeEditar = datos?.puedeEditar !== false

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Mis ejemplos</DialogTitle>
          <DialogDescription>
            Sube historias y carruseles que ya hiciste. La app aprende su diseño y lo usa al generar piezas nuevas.
          </DialogDescription>
        </DialogHeader>

        <div className="inline-flex rounded-lg border border-border p-0.5" role="tablist">
          {(['historias', 'carrusel'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tipo === t}
              onClick={() => setTipo(t)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium ${
                tipo === t ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {NOMBRE[t]}
            </button>
          ))}
        </div>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                {delTipo.length}/{MAX_EJEMPLOS_POR_TIPO} ejemplos de {NOMBRE[tipo].toLowerCase()}
              </span>
              {puedeEditar && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={ocupado !== null || delTipo.length >= MAX_EJEMPLOS_POR_TIPO}
                    onClick={() => inputRef.current?.click()}
                    className="gap-1.5"
                  >
                    {ocupado === 'subiendo' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    Subir capturas
                  </Button>
                  <input
                    ref={inputRef}
                    type="file"
                    multiple
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.length) void subir(e.target.files)
                      e.target.value = ''
                    }}
                  />
                </>
              )}
            </div>
            {delTipo.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                Sin ejemplos todavía. Sube capturas de {tipo === 'historias' ? 'historias' : 'carruseles'} que
                representen tu estilo (una captura por historia o por slide).
              </p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {delTipo.map((e) => (
                  <div key={e.id} className="group relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={e.url}
                      alt={e.name}
                      className="aspect-[9/16] w-full rounded-md border border-border object-cover"
                    />
                    {puedeEditar && (
                      <button
                        onClick={() =>
                          void fetch(`${base}?id=${e.id}`, { method: 'DELETE' })
                            .then((r) => aplicar(r, ''))
                            .catch((err) => toast.error((err as Error).message))
                        }
                        className="absolute right-1 top-1 rounded bg-card/90 p-1 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100"
                        title="Quitar"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Guía de estilo que la app seguirá</span>
              {puedeEditar && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={ocupado !== null || delTipo.length === 0}
                  onClick={() =>
                    void accion('analizando', async () =>
                      aplicar(
                        await fetch(base, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ accion: 'analizar', tipo }),
                        }),
                        'Guía de estilo creada'
                      )
                    )
                  }
                  className="gap-1.5"
                >
                  {ocupado === 'analizando' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Analizar mis ejemplos
                </Button>
              )}
            </div>
            <textarea
              value={guia}
              onChange={(e) => setGuia(e.target.value)}
              readOnly={!puedeEditar}
              rows={9}
              placeholder="Aquí aparecerá la descripción de tu estilo (tipografías, cajas de texto, colores, estructura…). Puedes corregirla a mano."
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
            {puedeEditar && (
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  disabled={ocupado !== null || guia === (datos?.guia[tipo] ?? '')}
                  onClick={() =>
                    void accion('guardando', async () =>
                      aplicar(
                        await fetch(base, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ tipo, guia }),
                        }),
                        'Guía guardada'
                      )
                    )
                  }
                  className="bg-brand-600 text-white hover:bg-brand-500"
                >
                  Guardar cambios
                </Button>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
