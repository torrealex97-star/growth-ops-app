'use client'

import { useEffect, useState } from 'react'
import { ImageIcon, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useTenant } from '@/lib/tenant-context'
import type { ImageProvider, TipoPieza } from '@/lib/ai/imagenes'

const NOMBRE: Record<ImageProvider, string> = { gemini: 'Gemini (Nano Banana)', openai: 'OpenAI (gpt-image-1)' }
const TIPOS: Array<{ id: TipoPieza; label: string }> = [
  { id: 'carrusel', label: 'Slide de carrusel' },
  { id: 'flyer', label: 'Flyer' },
  { id: 'historia', label: 'Historia' },
]

/**
 * Genera una imagen con Gemini u OpenAI y la añade como slide. El texto que debe salir en la imagen va en
 * un campo aparte y corto: los modelos de imagen escriben bien una frase y mal un párrafo.
 */
export function ImagenIaDialog({
  projectId,
  onCreated,
  ideaInicial = '',
}: {
  projectId: string
  onCreated: () => void
  ideaInicial?: string
}) {
  const tenant = useTenant()
  const [abierto, setAbierto] = useState(false)
  const [disponibles, setDisponibles] = useState<ImageProvider[] | null>(null)
  const [tipo, setTipo] = useState<TipoPieza>('carrusel')
  const [proveedor, setProveedor] = useState<ImageProvider | ''>('')
  const [idea, setIdea] = useState(ideaInicial)
  const [texto, setTexto] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!abierto) return
    const controlador = new AbortController()
    fetch(`/api/${tenant}/evergreen/carruseles/imagen`, { signal: controlador.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { disponibles?: ImageProvider[] } | null) => setDisponibles(d?.disponibles ?? []))
      .catch(() => setDisponibles(null))
    return () => controlador.abort()
  }, [abierto, tenant])

  const generar = async () => {
    setOcupado(true)
    setError(null)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/carruseles/imagen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea,
          textoEnImagen: texto || undefined,
          tipo,
          proveedor: proveedor || undefined,
          projectId,
          comoSlide: true,
        }),
      })
      const datos = (await res.json().catch(() => ({}))) as {
        error?: string
        proveedor?: ImageProvider
        fallbackReason?: string | null
      }
      if (!res.ok) return setError(datos.error ?? `Error ${res.status}`)
      toast.success(
        `Imagen creada con ${datos.proveedor ? NOMBRE[datos.proveedor] : 'IA'}${datos.fallbackReason ? ` · ${datos.fallbackReason}` : ''}`
      )
      setAbierto(false)
      onCreated()
    } catch {
      setError('No se pudo conectar. Inténtalo de nuevo.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setAbierto(true)}
        className="text-muted-foreground gap-1"
        title="Generar imagen con IA"
      >
        <ImageIcon className="h-3.5 w-3.5" /> Imagen IA
      </Button>
      <Dialog open={abierto} onOpenChange={setAbierto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generar imagen con IA</DialogTitle>
          </DialogHeader>
          {disponibles !== null && disponibles.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No hay ningún proveedor de imágenes conectado. Conecta una clave de Gemini u OpenAI en Ajustes →
              Integraciones → Inteligencia artificial.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2" role="group" aria-label="Tipo de pieza">
                {TIPOS.map((t) => (
                  <Button
                    key={t.id}
                    type="button"
                    size="sm"
                    variant={tipo === t.id ? 'default' : 'outline'}
                    aria-pressed={tipo === t.id}
                    onClick={() => setTipo(t.id)}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
              <div className="space-y-1">
                <Label htmlFor="imagen-idea">Qué quieres ver</Label>
                <Textarea
                  id="imagen-idea"
                  value={idea}
                  onChange={(e) => setIdea(e.target.value)}
                  rows={4}
                  maxLength={1500}
                  placeholder="Ej.: closer joven en una videollamada, luz cálida, sensación de confianza"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="imagen-texto">Texto en la imagen (opcional, corto)</Label>
                <Input
                  id="imagen-texto"
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  maxLength={120}
                  placeholder="Ej.: ¿Te parece caro?"
                />
              </div>
              {disponibles && disponibles.length > 1 && (
                <div className="space-y-1">
                  <Label htmlFor="imagen-proveedor">Proveedor</Label>
                  <select
                    id="imagen-proveedor"
                    value={proveedor}
                    onChange={(e) => setProveedor(e.target.value as ImageProvider | '')}
                    className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm"
                  >
                    <option value="">Automático</option>
                    {disponibles.map((p) => (
                      <option key={p} value={p}>
                        {NOMBRE[p]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {error && (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
              <Button
                onClick={generar}
                disabled={ocupado || !idea.trim() || disponibles === null}
                className="w-full gap-1.5"
              >
                {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                {ocupado ? 'Generando…' : 'Generar y añadir como slide'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
