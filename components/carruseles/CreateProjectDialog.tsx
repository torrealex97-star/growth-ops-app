'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Loader2, LayoutGrid, FileImage } from 'lucide-react'
import { toast } from 'sonner'
import type { AspectRatio, ProjectKind } from '@/lib/carruseles/types'
import { ASPECT_LABELS } from '@/lib/carruseles/types'
import { useTenant } from '@/lib/tenant-context'
import {
  LONGITUDES,
  MAX_TEMA,
  OPCIONES_CATEGORIA,
  mensajeInicial,
  type CategoriaElegida,
} from '@/lib/carruseles/historias/briefing'
import { claveEncargo } from '@/lib/carruseles/historias/encargo'

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
}

const RATIOS_BY_KIND: Record<ProjectKind, AspectRatio[]> = {
  carousel: ['4:5', '1:1', '9:16'],
  flyer: ['A4', '3:4', '1:1', '9:16'],
}

export function CreateProjectDialog({ open, onOpenChange }: Props) {
  const tenant = useTenant()
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<ProjectKind>('carousel')
  const [ratio, setRatio] = useState<AspectRatio>('4:5')
  const [creating, setCreating] = useState(false)
  const [categoria, setCategoria] = useState<CategoriaElegida>('auto')
  const [longitud, setLongitud] = useState<number>(5)
  const [tema, setTema] = useState('')
  // Un carrusel en formato 9:16 es una secuencia de historias.
  const esHistorias = kind === 'carousel' && ratio === '9:16'

  const pickKind = (k: ProjectKind) => {
    setKind(k)
    setRatio(RATIOS_BY_KIND[k][0])
  }

  const create = async () => {
    setCreating(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/carruseles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title:
            title.trim() || (kind === 'flyer' ? 'Nuevo flyer' : esHistorias ? 'Nuevas historias' : 'Nuevo carrusel'),
          kind,
          aspectRatio: ratio,
        }),
      })
      if (!res.ok) throw new Error('Error al crear')
      const project = await res.json()
      if (esHistorias) {
        // El encargo queda como botón «Generar secuencia» en el chat (no se envía solo: primero se suben las fotos).
        try {
          sessionStorage.setItem(claveEncargo(project.id), mensajeInicial({ categoria, longitud, tema }))
        } catch {
          /* sin sessionStorage el chat arranca vacío y se describe a mano */
        }
      }
      router.push(`/${tenant}/instagram/carruseles/${project.id}`)
    } catch (e) {
      toast.error((e as Error).message)
      setCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo proyecto</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            {[
              { k: 'carousel' as const, label: 'Carrusel', desc: 'Varias slides', Icon: LayoutGrid },
              { k: 'flyer' as const, label: 'Flyer', desc: 'Pieza única', Icon: FileImage },
            ].map(({ k, label, desc, Icon }) => (
              <button
                key={k}
                onClick={() => pickKind(k)}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors',
                  kind === k ? 'border-brand-400 bg-brand-600/10' : 'border-border hover:border-muted-foreground/40'
                )}
              >
                <Icon className={cn('h-5 w-5', kind === k ? 'text-brand-400' : 'text-muted-foreground')} />
                <span className="text-sm font-medium">{label}</span>
                <span className="text-2xs text-muted-foreground">{desc}</span>
              </button>
            ))}
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Título</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={kind === 'flyer' ? 'Nuevo flyer' : 'Nuevo carrusel'}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Formato</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {RATIOS_BY_KIND[kind].map((r) => (
                <button
                  key={r}
                  onClick={() => setRatio(r)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium border transition-colors',
                    ratio === r
                      ? 'border-brand-400 bg-brand-600/10 text-brand-300'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  )}
                >
                  {ASPECT_LABELS[r]}
                </button>
              ))}
            </div>
          </div>

          {esHistorias && (
            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">
                Secuencia de historias con el estilo del editor de Instagram. Después subes tus fotos y la generas.
              </p>
              <div>
                <label htmlFor="hist-categoria" className="text-xs font-medium text-muted-foreground">
                  Categoría
                </label>
                <select
                  id="hist-categoria"
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value as CategoriaElegida)}
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                >
                  {OPCIONES_CATEGORIA.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="text-xs font-medium text-muted-foreground">Nº de historias</span>
                <div className="mt-1 flex gap-2" role="group" aria-label="Número de historias">
                  {LONGITUDES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setLongitud(n)}
                      aria-pressed={longitud === n}
                      className={cn(
                        'px-3 py-1.5 rounded-md text-xs font-medium border tabular-nums transition-colors',
                        longitud === n
                          ? 'border-brand-400 bg-brand-600/10 text-brand-300'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label htmlFor="hist-tema" className="text-xs font-medium text-muted-foreground">
                  Tema (opcional)
                </label>
                <textarea
                  id="hist-tema"
                  value={tema}
                  maxLength={MAX_TEMA}
                  onChange={(e) => setTema(e.target.value)}
                  rows={3}
                  placeholder="De qué quieres hablar. Si lo dejas vacío, propongo uno según tu negocio."
                  className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={create} disabled={creating} className="bg-brand-600 hover:bg-brand-500 text-white">
            {creating && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
            Crear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
