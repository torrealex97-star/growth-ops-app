'use client'

import { useCallback, useEffect, useState } from 'react'
import { Palette, Wand2 } from 'lucide-react'
import { BrandDialog } from './BrandDialog'
import { ESTILOS, ESTILO_IDS, marcaConColores, type EstiloId } from '@/lib/carruseles/estilos'
import { DEFAULT_BRAND, type BrandConfig } from '@/lib/carruseles/types'
import { useTenant } from '@/lib/tenant-context'

interface Props {
  esHistorias: boolean
  estilo: EstiloId
  onEstilo: (e: EstiloId) => void
  fotosDeFondo: boolean
  onFotosDeFondo: (v: boolean) => void
  numMedios: number
  numSlides: number
  ocupado: boolean
  onAplicar: () => void
}

/** Marca de la subcuenta, estilo de composición y uso de las fotos/vídeos: lo que decide cómo sale el diseño. */
export function EstiloPanel(p: Props) {
  const tenant = useTenant()
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND)
  const [marcaOpen, setMarcaOpen] = useState(false)

  const cargarMarca = useCallback(() => {
    fetch(`/api/${tenant}/evergreen/carruseles/brand`)
      .then((r) => r.json())
      .then((b) =>
        setBrand({
          ...DEFAULT_BRAND,
          ...b,
          colors: { ...DEFAULT_BRAND.colors, ...b.colors },
          fonts: { ...DEFAULT_BRAND.fonts, ...b.fonts },
        })
      )
      .catch(() => {})
  }, [tenant])

  useEffect(() => {
    cargarMarca()
  }, [cargarMarca])

  const configurada = marcaConColores(brand)
  const colores = [brand.colors.primary, brand.colors.secondary, brand.colors.accent]

  return (
    <div className="px-4 py-3 border-b border-border space-y-3">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">Marca</span>
          <button
            onClick={() => setMarcaOpen(true)}
            className="flex items-center gap-1 text-3xs text-muted-foreground hover:text-foreground"
          >
            <Palette className="h-3 w-3" />
            {configurada ? 'Editar' : 'Configurar'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          {brand.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt="Logo" className="h-7 max-w-[72px] object-contain" />
          )}
          <div className="flex gap-1">
            {colores.map((c, i) => (
              <span key={i} className="h-5 w-5 rounded-full border border-border" style={{ background: c }} />
            ))}
          </div>
          <span className="text-3xs text-muted-foreground truncate">
            {brand.name || 'Sin nombre'} · {brand.fonts.heading}
          </span>
        </div>
        {!configurada && (
          <p className="mt-1.5 text-3xs text-amber-500">
            La marca usa los colores de fábrica. Configura tus colores, tipografías y logo para que las historias salgan
            con tu identidad.
          </p>
        )}
      </div>

      <div>
        <span className="text-3xs font-semibold uppercase tracking-wider text-muted-foreground">Estilo</span>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {ESTILO_IDS.map((id) => (
            <button
              key={id}
              onClick={() => p.onEstilo(id)}
              aria-pressed={p.estilo === id}
              className={`rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                p.estilo === id
                  ? 'border-brand-400 bg-brand-600/10 text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="block font-medium">{ESTILOS[id].nombre}</span>
              <span className="block text-3xs leading-tight text-muted-foreground">{ESTILOS[id].descripcion}</span>
            </button>
          ))}
        </div>
      </div>

      {p.esHistorias ? (
        p.numMedios === 0 && (
          <p className="text-3xs text-amber-500">
            Sin fotos ni vídeos: las historias saldrán con fondo liso de tu marca. Súbelos en «Fotos y vídeos».
          </p>
        )
      ) : (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={p.fotosDeFondo}
            onChange={(e) => p.onFotosDeFondo(e.target.checked)}
            disabled={p.numMedios === 0}
          />
          Usar mis fotos como fondo de las slides
        </label>
      )}

      {p.numSlides > 0 && (
        <button
          onClick={p.onAplicar}
          disabled={p.ocupado}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          <Wand2 className="h-3.5 w-3.5" />
          Rehacer {p.esHistorias ? 'las historias' : 'las slides'} con este estilo
        </button>
      )}

      <BrandDialog
        open={marcaOpen}
        onOpenChange={(o) => {
          setMarcaOpen(o)
          if (!o) cargarMarca()
        }}
      />
    </div>
  )
}
