'use client'

import { useMemo, useRef, useEffect, useState, useCallback } from 'react'
import { extractFontFamilies, wrapSlideHtml } from '@/lib/carruseles/slide-html'
import type { AspectRatio } from '@/lib/carruseles/types'
import { DIMENSIONS } from '@/lib/carruseles/types'

/** Tipo de dato con el que una miniatura de «Fotos y vídeos» se arrastra hasta la slide (su número, desde 1). */
export const TIPO_ARRASTRE_MEDIO = 'application/x-carrusel-medio'

/** Caja de una capa tal y como la pinta el navegador (píxeles del lienzo, sin contar el giro). */
export type MedidaCapa = { x: number; y: number; w: number; h: number }

/** Modo editable: el editor libre necesita medir cada capa y moverlas en vivo dentro de la slide. */
export interface EdicionSlide {
  /** Documento de la slide (o null al desmontar), para dar feedback inmediato mientras se arrastra. */
  onDocumento?: (doc: Document | null) => void
  /** Cajas de todas las capas (`data-capa`), cada vez que cambia el contenido, cargan fuentes o imágenes. */
  onMedidas?: (m: Record<string, MedidaCapa>) => void
}

interface SlideRendererProps {
  html: string
  aspectRatio: AspectRatio
  className?: string
  style?: React.CSSProperties
  /** Capa encima de la slide (coordenadas relativas a ella), p. ej. para arrastrar elementos. */
  overlay?: React.ReactNode
  /** Si se define, la slide acepta que se le suelte una foto/vídeo arrastrado desde «Fotos y vídeos». */
  onDropMedio?: (indice: number) => void
  /** Solo para el editor libre: abre la slide a su propio código (sin scripts) para medirla y moverla. */
  editable?: EdicionSlide
}

const estiloIframe = (w: number, h: number, scale: number): React.CSSProperties => ({
  width: w,
  height: h,
  border: 'none',
  transform: `scale(${scale})`,
  transformOrigin: 'top left',
  position: 'absolute',
  top: 0,
  left: 0,
  pointerEvents: 'none',
})

/**
 * Slide editable. El iframe NO se recarga con cada cambio (parpadearía al arrastrar): se sustituye el contenido de su <body>.
 * Solo se vuelve a montar (clave) si cambian las tipografías o el formato, que viven en la cabecera del documento.
 * Mismo origen para poder medir y mover las capas, pero SIN scripts: nada del contenido se ejecuta.
 */
function IframeEditable({
  html,
  aspectRatio,
  slideW,
  slideH,
  scale,
  edicion,
}: {
  html: string
  aspectRatio: AspectRatio
  slideW: number
  slideH: number
  scale: number
  edicion: EdicionSlide
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [srcDoc] = useState(() => wrapSlideHtml(html, aspectRatio))
  const callbacks = useRef(edicion)
  const cargado = useRef(false)
  useEffect(() => {
    callbacks.current = edicion
  })

  const medir = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    const cb = callbacks.current.onMedidas
    if (!doc || !cb) return
    const mapa: Record<string, MedidaCapa> = {}
    doc.querySelectorAll<HTMLElement>('[data-capa]').forEach((el) => {
      if (el.dataset.capa)
        mapa[el.dataset.capa] = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }
    })
    cb(mapa)
  }, [])

  const alCargar = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    if (!doc) return
    cargado.current = true
    callbacks.current.onDocumento?.(doc)
    medir()
    // Las fuentes y las imágenes cambian el alto del texto y de las cajas: se vuelve a medir cuando terminan.
    void doc.fonts?.ready.then(medir)
    doc.addEventListener('load', medir, true)
  }, [medir])

  useEffect(() => {
    if (!cargado.current) return
    const doc = iframeRef.current?.contentDocument
    if (!doc?.body) return
    if (doc.body.innerHTML !== html) doc.body.innerHTML = html
    medir()
    callbacks.current.onDocumento?.(doc)
  }, [html, medir])

  useEffect(
    () => () => {
      cargado.current = false
      callbacks.current.onDocumento?.(null)
    },
    []
  )

  return (
    <iframe
      ref={iframeRef}
      onLoad={alCargar}
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
      title="Slide preview"
      style={estiloIframe(slideW, slideH, scale)}
    />
  )
}

export function SlideRenderer({
  html,
  aspectRatio,
  className,
  style,
  overlay,
  onDropMedio,
  editable,
}: SlideRendererProps) {
  const outerRef = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const { width: slideW, height: slideH } = DIMENSIONS[aspectRatio]

  const srcDoc = useMemo(() => wrapSlideHtml(html, aspectRatio), [html, aspectRatio])
  const claveCabecera = `${aspectRatio}|${extractFontFamilies(html).join('|')}`

  const measure = useCallback(() => {
    const el = outerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) setDims({ w: rect.width, h: rect.height })
  }, [])

  useEffect(() => {
    const el = outerRef.current
    if (!el) return
    const obs = new ResizeObserver(() => measure())
    obs.observe(el)
    measure()
    return () => obs.disconnect()
  }, [measure])

  const scale = dims ? Math.min(dims.w / slideW, dims.h / slideH) : 0
  const scaledW = Math.floor(slideW * scale)
  const scaledH = Math.floor(slideH * scale)

  return (
    <div
      ref={outerRef}
      className={className}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', ...style }}
    >
      {scale > 0 && (
        <div
          style={{
            width: scaledW,
            height: scaledH,
            overflow: 'hidden',
            borderRadius: 10,
            position: 'relative',
            boxShadow: '0 8px 30px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.2)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}
          onDragOver={onDropMedio ? (e) => e.preventDefault() : undefined}
          onDrop={
            onDropMedio
              ? (e) => {
                  e.preventDefault()
                  const n = Number(e.dataTransfer.getData(TIPO_ARRASTRE_MEDIO))
                  if (Number.isInteger(n) && n >= 1) onDropMedio(n)
                }
              : undefined
          }
        >
          {editable ? (
            <IframeEditable
              key={claveCabecera}
              html={html}
              aspectRatio={aspectRatio}
              slideW={slideW}
              slideH={slideH}
              scale={scale}
              edicion={editable}
            />
          ) : (
            <iframe sandbox="" srcDoc={srcDoc} title="Slide preview" style={estiloIframe(slideW, slideH, scale)} />
          )}
          {overlay}
        </div>
      )}
    </div>
  )
}
