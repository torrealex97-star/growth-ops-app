'use client'

import { useRef, useState } from 'react'
import {
  LIENZO,
  MAX_CAPAS,
  ajustar,
  capaNueva,
  duplicar,
  estiloFondoPos,
  invasionZonaSegura,
  sinCapa,
  type Caja,
  type Capa,
  type FondoPos,
  type Guias,
} from '@/lib/carruseles/historias/capas'
import type { Plataforma } from '@/lib/carruseles/historias/estilo-nativo'
import { TIPO_ARRASTRE_MEDIO, type MedidaCapa } from '../SlideRenderer'

// Capa interactiva encima de la historia (el iframe no recibe el ratón). Todo se calcula en píxeles del lienzo de
// 1080×1920: el elemento ocupa la historia entera y convierte los píxeles de pantalla con la escala del momento.
// Mientras se arrastra se mueve el elemento real dentro de la slide (feedback inmediato, sin recargar); al soltar se
// confirma el cambio, que es lo que se guarda y entra en el historial de deshacer.

type Cambio = Partial<Capa> & Record<string, unknown>

// `ultimo` es el último valor calculado por el gesto. Se guarda aquí (no solo en el estado de React) porque al soltar el
// ratón React puede no haber repintado aún tras el último movimiento: leerlo del estado descartaría el gesto en silencio.
type Gesto = (
  | { tipo: 'mover'; id: string; px: number; py: number; c0: Capa; caja0: Caja; otras: Caja[]; movido: boolean }
  | { tipo: 'escalar'; id: string; px: number; c0: Capa; caja0: Caja; libre: boolean }
  | { tipo: 'ancho'; id: string; px: number; c0: Capa; caja0: Caja }
  | { tipo: 'girar'; id: string; c0: Capa; cx: number; cy: number }
  | { tipo: 'fondo'; px: number; py: number; pos0: FondoPos }
) & { ultimo?: Cambio }

interface Props {
  capas: Capa[]
  seleccion: string | null
  onSeleccion: (id: string | null) => void
  /** Cambio confirmado de las capas. `clave` agrupa cambios seguidos del mismo tipo en un solo paso de deshacer. */
  onCambio: (capas: Capa[], clave?: string) => void
  medidas: Record<string, MedidaCapa>
  doc: Document | null
  plataforma: Plataforma
  deshabilitado: boolean
  modoFondo: boolean
  fondoPos: FondoPos | undefined
  onFondoPos: (p: FondoPos) => void
  onDeshacer: () => void
  onRehacer: () => void
}

const limita = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

// El ancho y el alto de imágenes y formas los decide la capa; solo el alto del texto, los emojis y los stickers lo decide el
// navegador al pintarlos (se mide). Así el recuadro de selección no «salta» con medidas antiguas justo tras cambiar el tamaño.
const cajaDe = (c: Capa, m: MedidaCapa | undefined): Caja => ({
  x: c.x,
  y: c.y,
  w: c.w,
  h: 'h' in c ? c.h : (m?.h ?? (c.tipo === 'emoji' ? c.tam : 120)),
})

/** Mueve el elemento real de la slide para dar feedback inmediato mientras dura el gesto. */
function aplicarVivo(doc: Document | null, c: Capa, cambios: Cambio) {
  const el = doc?.querySelector<HTMLElement>(`[data-capa="${CSS.escape(c.id)}"]`)
  if (!el) return
  const v = { ...c, ...cambios } as Capa
  el.style.left = `${v.x}px`
  el.style.top = `${v.y}px`
  el.style.width = `${v.w}px`
  if ('h' in v && (v.tipo === 'imagen' || v.tipo === 'forma')) el.style.height = `${v.h}px`
  el.style.transform = v.rot ? `rotate(${v.rot}deg)` : ''
  if (v.tipo === 'texto') {
    const cont = el.firstElementChild as HTMLElement | null
    if (cont) cont.style.fontSize = `${v.tam}px`
    const t = el.querySelector<HTMLElement>('.ig-texto')
    if (t) t.style.fontSize = `${v.tam}px`
  }
  if (v.tipo === 'emoji') {
    const e = el.querySelector<HTMLElement>('.ig-capa-emoji')
    if (e) e.style.fontSize = `${v.tam}px`
  }
  if (v.tipo === 'forma') {
    const s = el.querySelector('svg')
    if (s) {
      s.setAttribute('preserveAspectRatio', 'none')
      s.style.width = '100%'
      s.style.height = '100%'
    }
  }
}

export function EditorCapas({
  capas,
  seleccion,
  onSeleccion,
  onCambio,
  medidas,
  doc,
  plataforma,
  deshabilitado,
  modoFondo,
  fondoPos,
  onFondoPos,
  onDeshacer,
  onRehacer,
}: Props) {
  const raiz = useRef<HTMLDivElement>(null)
  const gesto = useRef<Gesto | null>(null)
  const [vivo, setVivo] = useState<{ id: string; cambios: Cambio } | null>(null)
  const [guias, setGuias] = useState<Guias>({ x: [], y: [] })

  const escala = () => LIENZO.ancho / (raiz.current?.getBoundingClientRect().width || LIENZO.ancho)
  const aLienzo = (e: { clientX: number; clientY: number }) => {
    const r = raiz.current?.getBoundingClientRect()
    const k = escala()
    return { x: Math.round((e.clientX - (r?.left ?? 0)) * k), y: Math.round((e.clientY - (r?.top ?? 0)) * k) }
  }
  const visibles = capas.map((c) => (vivo?.id === c.id ? ({ ...c, ...vivo.cambios } as Capa) : c))
  const elegida = seleccion ? (visibles.find((c) => c.id === seleccion) ?? null) : null

  const empezar = (g: Gesto, e: React.PointerEvent) => {
    gesto.current = g
    e.currentTarget.setPointerCapture(e.pointerId)
    raiz.current?.focus({ preventScroll: true })
    e.stopPropagation()
  }

  const alMover = (e: React.PointerEvent) => {
    const g = gesto.current
    if (!g) return
    const k = escala()
    if (g.tipo === 'fondo') {
      const dx = (e.clientX - g.px) * k
      const dy = (e.clientY - g.py) * k
      const z = g.pos0.zoom
      const pos: FondoPos = {
        x: Math.round(limita(g.pos0.x - (dx / LIENZO.ancho) * 100 * (z > 1 ? 1 / z : 1), 0, 100)),
        y: Math.round(limita(g.pos0.y - (dy / LIENZO.alto) * 100 * (z > 1 ? 1 / z : 1), 0, 100)),
        zoom: z,
      }
      const img = doc?.querySelector<HTMLElement>('.ig-fondo .ig-foto')
      if (img) img.style.cssText += `;${estiloFondoPos(pos)}`
      g.ultimo = pos as unknown as Cambio
      setVivo({ id: '__fondo', cambios: g.ultimo })
      return
    }
    if (g.tipo === 'mover') {
      const dx = (e.clientX - g.px) * k
      const dy = (e.clientY - g.py) * k
      if (!g.movido && Math.hypot(dx, dy) < 3) return
      g.movido = true
      let x = g.caja0.x + dx
      let y = g.caja0.y + dy
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) y = g.caja0.y
        else x = g.caja0.x
      }
      let guiasAhora: Guias = { x: [], y: [] }
      if (!e.altKey) {
        const a = ajustar({ ...g.caja0, x, y }, g.otras, { plataforma })
        x = a.x
        y = a.y
        guiasAhora = a.guias
      }
      setGuias(guiasAhora)
      const cambios = { x: Math.round(x), y: Math.round(y) }
      aplicarVivo(doc, g.c0, cambios)
      g.ultimo = cambios
      setVivo({ id: g.id, cambios })
      return
    }
    if (g.tipo === 'escalar' || g.tipo === 'ancho') {
      const dx = (e.clientX - g.px) * k
      const base = g.caja0.w
      const nuevoW = limita(Math.round(base + dx), 40, 1400)
      const f = nuevoW / base
      const c = g.c0
      let cambios: Cambio = { w: nuevoW }
      if (g.tipo === 'escalar') {
        if (c.tipo === 'texto') cambios = { w: nuevoW, tam: limita(Math.round(c.tam * f), 20, 260) }
        else if (c.tipo === 'emoji') cambios = { w: nuevoW, tam: limita(Math.round(c.tam * f), 40, 400) }
        else if (c.tipo === 'imagen' || c.tipo === 'forma')
          cambios = { w: nuevoW, h: g.libre ? c.h : limita(Math.round(g.caja0.h * f), 20, 2400) }
      }
      aplicarVivo(doc, c, cambios)
      g.ultimo = cambios
      setVivo({ id: g.id, cambios })
      return
    }
    if (g.tipo === 'girar') {
      const ang = (Math.atan2(e.clientY - g.cy, e.clientX - g.cx) * 180) / Math.PI + 90
      let rot = ((ang + 540) % 360) - 180
      // Se pega a 0°, ±90° y 180° (o cada 15° con Mayús) para que quede recto con facilidad.
      const paso = e.shiftKey ? 15 : 90
      const cerca = Math.round(rot / paso) * paso
      if (Math.abs(rot - cerca) < 4 || e.shiftKey) rot = cerca
      const cambios = { rot: Math.round(rot * 10) / 10 || undefined }
      aplicarVivo(doc, g.c0, cambios)
      g.ultimo = cambios
      setVivo({ id: g.id, cambios })
    }
  }

  const terminar = () => {
    const g = gesto.current
    gesto.current = null
    setVivo(null)
    setGuias({ x: [], y: [] })
    if (!g?.ultimo) return
    if (g.tipo === 'fondo') return onFondoPos(g.ultimo as unknown as FondoPos)
    if (g.tipo === 'mover' && !g.movido) return
    const { id } = g
    const cambios = g.ultimo
    onCambio(
      capas.map((c) => (c.id === id ? ({ ...c, ...cambios } as Capa) : c)),
      `gesto-${g.tipo}-${id}`
    )
  }

  const alTeclear = (e: React.KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey
    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      return e.shiftKey ? onRehacer() : onDeshacer()
    }
    if (meta && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      return onRehacer()
    }
    if (!elegida) return
    if (e.key === 'Escape') return onSeleccion(null)
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      onSeleccion(null)
      return onCambio(sinCapa(capas, elegida.id))
    }
    if (meta && e.key.toLowerCase() === 'd') {
      e.preventDefault()
      const r = duplicar(capas, elegida.id)
      if (r.nueva) {
        onCambio(r.capas)
        onSeleccion(r.nueva.id)
      }
      return
    }
    const paso = e.shiftKey ? 10 : 1
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-paso, 0],
      ArrowRight: [paso, 0],
      ArrowUp: [0, -paso],
      ArrowDown: [0, paso],
    }
    if (d[e.key] && !elegida.bloqueada) {
      e.preventDefault()
      const [dx, dy] = d[e.key]
      onCambio(
        capas.map((c) => (c.id === elegida.id ? ({ ...c, x: c.x + dx, y: c.y + dy } as Capa) : c)),
        `flechas-${elegida.id}`
      )
    }
  }

  // Soltar una foto de «Fotos y vídeos»: sobre una foto ya colocada la sustituye; en otro sitio, añade una foto nueva ahí.
  const alSoltar = (e: React.DragEvent) => {
    e.preventDefault()
    const n = Number(e.dataTransfer.getData(TIPO_ARRASTRE_MEDIO))
    if (!Number.isInteger(n) || n < 1 || deshabilitado) return
    const p = aLienzo(e)
    const sobre = [...visibles].reverse().find((c) => {
      if (c.tipo !== 'imagen' || c.oculta) return false
      const b = cajaDe(c, medidas[c.id])
      return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
    })
    if (sobre) {
      onCambio(
        capas.map((c) => (c.id === sobre.id ? ({ ...c, foto: n, url: undefined, pedido: undefined } as Capa) : c))
      )
      return onSeleccion(sobre.id)
    }
    if (capas.length >= MAX_CAPAS) return
    const nueva = capaNueva('imagen', capas, { x: p.x, y: p.y, foto: n })
    onCambio([...capas, nueva])
    onSeleccion(nueva.id)
  }

  if (deshabilitado) return null
  const posFondo: FondoPos = fondoPos ?? { x: 50, y: 50, zoom: 1 }

  return (
    <div
      ref={raiz}
      tabIndex={0}
      role="application"
      aria-label="Lienzo de la historia: arrastra los elementos para colocarlos"
      className="absolute inset-0 z-10 touch-none outline-none"
      style={{ cursor: modoFondo ? 'grab' : undefined }}
      onKeyDown={alTeclear}
      onPointerMove={alMover}
      onPointerUp={terminar}
      onPointerCancel={terminar}
      onDragOver={(e) => e.preventDefault()}
      onDrop={alSoltar}
      onPointerDown={(e) => {
        if (modoFondo) return empezar({ tipo: 'fondo', px: e.clientX, py: e.clientY, pos0: posFondo }, e)
        if (e.target === e.currentTarget) {
          onSeleccion(null)
          raiz.current?.focus({ preventScroll: true })
        }
      }}
    >
      {guias.x.map((x) => (
        <div
          key={`gx${x}`}
          className="pointer-events-none absolute top-0 bottom-0 w-px bg-fuchsia-400"
          style={{ left: `${(x / LIENZO.ancho) * 100}%` }}
        />
      ))}
      {guias.y.map((y) => (
        <div
          key={`gy${y}`}
          className="pointer-events-none absolute left-0 right-0 h-px bg-fuchsia-400"
          style={{ top: `${(y / LIENZO.alto) * 100}%` }}
        />
      ))}

      {!modoFondo &&
        visibles.map((c) => {
          if (c.oculta) return null
          const b = cajaDe(c, medidas[c.id])
          const activa = c.id === seleccion
          const tapada = activa && invasionZonaSegura(b, plataforma)
          return (
            <div
              key={c.id}
              data-hit={c.id}
              className={`absolute ${c.bloqueada ? 'pointer-events-none' : 'cursor-move'} ${
                activa
                  ? tapada
                    ? 'outline outline-2 outline-dashed outline-red-500'
                    : 'outline outline-2 outline-brand-400'
                  : 'hover:outline hover:outline-1 hover:outline-white/60'
              }`}
              style={{
                left: `${(b.x / LIENZO.ancho) * 100}%`,
                top: `${(b.y / LIENZO.alto) * 100}%`,
                width: `${(b.w / LIENZO.ancho) * 100}%`,
                height: `${(b.h / LIENZO.alto) * 100}%`,
                transform: c.rot ? `rotate(${c.rot}deg)` : undefined,
              }}
              onPointerDown={(e) => {
                if (c.bloqueada) return
                onSeleccion(c.id)
                const otras = visibles.filter((o) => o.id !== c.id && !o.oculta).map((o) => cajaDe(o, medidas[o.id]))
                empezar(
                  { tipo: 'mover', id: c.id, px: e.clientX, py: e.clientY, c0: c, caja0: b, otras, movido: false },
                  e
                )
              }}
            >
              {activa && !c.bloqueada && (
                <>
                  <Asa
                    className="-right-2 -bottom-2 cursor-nwse-resize"
                    titulo="Cambiar de tamaño (Mayús: libre)"
                    onDown={(e) =>
                      empezar({ tipo: 'escalar', id: c.id, px: e.clientX, c0: c, caja0: b, libre: e.shiftKey }, e)
                    }
                  />
                  <Asa
                    className="-right-2 top-1/2 -translate-y-1/2 cursor-ew-resize"
                    titulo="Cambiar el ancho"
                    onDown={(e) => empezar({ tipo: 'ancho', id: c.id, px: e.clientX, c0: c, caja0: b }, e)}
                  />
                  <Asa
                    className="left-1/2 -top-7 -translate-x-1/2 cursor-grab rounded-full"
                    titulo="Girar (Mayús: de 15 en 15°)"
                    onDown={(e) => {
                      const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
                      empezar({ tipo: 'girar', id: c.id, c0: c, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }, e)
                    }}
                  />
                </>
              )}
            </div>
          )
        })}
      {modoFondo && (
        <p className="pointer-events-none absolute inset-x-0 top-2 mx-auto w-fit rounded-full bg-black/70 px-3 py-1 text-3xs text-white">
          Arrastra para reencuadrar la foto
        </p>
      )}
    </div>
  )
}

function Asa({
  className,
  titulo,
  onDown,
}: {
  className: string
  titulo: string
  onDown: (e: React.PointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      title={titulo}
      onPointerDown={onDown}
      className={`absolute h-4 w-4 touch-none rounded-sm border-2 border-white bg-brand-500 shadow ${className}`}
    />
  )
}
