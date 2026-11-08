'use client'

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Lock,
  Redo2,
  Trash2,
  Undo2,
  Unlock,
} from 'lucide-react'
import {
  CAJAS_TEXTO,
  COLORES_FORMA,
  FORMAS,
  MAX_CAPAS,
  alinear,
  cambiarCapa,
  capaNueva,
  duplicar,
  ordenar,
  sinCapa,
  type Alineado,
  type Capa,
  type CajaTexto,
  type FondoPos,
  type TipoCapa,
} from '@/lib/carruseles/historias/capas'
import { FUENTES_IG } from '@/lib/carruseles/historias/fuentes-ig'
import type { Plataforma } from '@/lib/carruseles/historias/estilo-nativo'
import type { HistoriaSpec } from '@/lib/carruseles/historias/layouts'
import type { MedidaCapa } from '../SlideRenderer'

const input = 'w-full rounded-md border border-border bg-background px-2 py-1 text-sm'
const etiqueta = 'text-3xs font-semibold uppercase tracking-wider text-muted-foreground'
const boton =
  'flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1 text-3xs hover:bg-muted disabled:opacity-40'

const ETIQUETA_FUENTE: Record<(typeof FUENTES_IG)[number], string> = {
  classic: 'Clásica',
  modern: 'Moderna',
  neon: 'Neón',
  typewriter: 'Máquina',
  strong: 'Fuerte',
  serif: 'Serif',
}
const ETIQUETA_CAJA: Record<CajaTexto, string> = {
  sin: 'Sin caja',
  blanca: 'Blanca',
  negra: 'Negra',
  'negra-suave': 'Negra suave',
  'blanca-suave': 'Cristal',
  marca: 'Color de marca',
  marcador: 'Marcador',
}
const ETIQUETA_FORMA = { flecha: 'Flecha', circulo: 'Círculo', subrayado: 'Subrayado', caja: 'Recuadro' } as const
const ETIQUETA_COLOR = { blanco: 'Blanco', marca: 'Marca', rojo: 'Rojo', amarillo: 'Amarillo' } as const
const EMOJIS = ['🔥', '💡', '👀', '✅', '❌', '⚠️', '💰', '🚀', '❤️', '🤯', '👇', '👉', '⭐', '📈', '🎁', '💥']

export const nombreCapa = (c: Capa): string => {
  switch (c.tipo) {
    case 'texto':
      return c.texto.trim().slice(0, 24) || 'Texto vacío'
    case 'imagen':
      return c.pedido ? c.pedido.titulo : c.foto ? `Foto ${c.foto}` : 'Foto'
    case 'emoji':
      return `${c.emoji} Emoji`
    case 'sticker':
      return `Sticker ${c.sticker}`
    case 'forma':
      return ETIQUETA_FORMA[c.forma]
  }
}

interface Props {
  spec: HistoriaSpec
  capas: Capa[]
  seleccion: string | null
  onSeleccion: (id: string | null) => void
  onCambio: (capas: Capa[], clave?: string) => void
  /** Cambios en la historia (fondo, oscurecimiento…) que no son capas. */
  onSpec: (s: HistoriaSpec, clave?: string) => void
  medidas: Record<string, MedidaCapa>
  medios: { url: string; name: string }[]
  plataforma: Plataforma
  modoFondo: boolean
  onModoFondo: (v: boolean) => void
  otrasHistorias: { indice: number; titulo: string }[]
  onIntercambiar: (indice: number) => void
  onVolverAPlantilla: () => void
  puedeDeshacer: boolean
  puedeRehacer: boolean
  onDeshacer: () => void
  onRehacer: () => void
}

export function PanelCapas(p: Props) {
  const { capas, seleccion, onCambio, spec } = p
  const c = capas.find((x) => x.id === seleccion) ?? null
  const cambiar = (cambios: Partial<Capa>, clave?: string) =>
    c && onCambio(cambiarCapa(capas, c.id, cambios), clave ? `${clave}-${c.id}` : undefined)
  const anadir = (tipo: TipoCapa, extra: Parameters<typeof capaNueva>[2] = {}) => {
    if (capas.length >= MAX_CAPAS) return
    const nueva = capaNueva(tipo, capas, extra)
    onCambio([...capas, nueva])
    p.onSeleccion(nueva.id)
  }
  const alinearCon = (modo: Alineado) => {
    if (!c) return
    const m = p.medidas[c.id]
    const pos = alinear({ x: c.x, y: c.y, w: m?.w ?? c.w, h: m?.h ?? ('h' in c ? c.h : 120) }, modo, p.plataforma)
    cambiar(pos)
  }
  const fondoPos: FondoPos = spec.fondoPos ?? { x: 50, y: 50, zoom: 1 }
  const sinFotos = p.medios.length === 0

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        <button className={boton} disabled={!p.puedeDeshacer} onClick={p.onDeshacer} title="Deshacer (Ctrl/⌘ Z)">
          <Undo2 className="h-3 w-3" /> Deshacer
        </button>
        <button className={boton} disabled={!p.puedeRehacer} onClick={p.onRehacer} title="Rehacer (Ctrl/⌘ Mayús Z)">
          <Redo2 className="h-3 w-3" /> Rehacer
        </button>
      </div>

      <section aria-label="Añadir elementos">
        <p className={etiqueta}>Añadir a la historia</p>
        <div className="mt-1 grid grid-cols-2 gap-1">
          <button className={boton} onClick={() => anadir('texto')}>
            Texto
          </button>
          <button
            className={boton}
            disabled={sinFotos}
            onClick={() => anadir('imagen', { foto: 1 })}
            title={sinFotos ? 'Sube fotos en «Fotos y vídeos»' : undefined}
          >
            Foto
          </button>
          <button className={boton} onClick={() => anadir('sticker')}>
            Sticker
          </button>
          <button className={boton} onClick={() => anadir('forma')}>
            Flecha / forma
          </button>
        </div>
        <div className="mt-1 flex flex-wrap gap-0.5" aria-label="Emojis">
          {EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => anadir('emoji', { emoji: e })}
              className="rounded px-1 py-0.5 text-base hover:bg-muted"
              aria-label={`Añadir ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
        <p className="mt-1 text-3xs text-muted-foreground">
          Arrastra una foto de «Fotos y vídeos» sobre la historia para colocarla donde quieras.
        </p>
      </section>

      <section aria-label="Capas">
        <p className={etiqueta}>
          Capas ({capas.length}/{MAX_CAPAS}) · la de arriba va delante
        </p>
        {capas.length === 0 ? (
          <p className="mt-1 text-3xs text-muted-foreground">Historia sin elementos: añade uno arriba.</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {[...capas].reverse().map((x) => (
              <li
                key={x.id}
                className={`flex items-center gap-1 rounded-md border px-1 py-0.5 ${
                  x.id === seleccion ? 'border-brand-400 bg-brand-500/10' : 'border-transparent'
                }`}
              >
                <button
                  className="min-w-0 flex-1 truncate text-left text-3xs"
                  onClick={() => p.onSeleccion(x.id)}
                  aria-pressed={x.id === seleccion}
                >
                  {nombreCapa(x)}
                </button>
                <button
                  className="rounded p-0.5 hover:bg-muted"
                  aria-label={x.oculta ? 'Mostrar' : 'Ocultar'}
                  onClick={() => onCambio(cambiarCapa(capas, x.id, { oculta: x.oculta ? undefined : true }))}
                >
                  {x.oculta ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
                <button
                  className="rounded p-0.5 hover:bg-muted"
                  aria-label={x.bloqueada ? 'Desbloquear' : 'Bloquear'}
                  onClick={() => onCambio(cambiarCapa(capas, x.id, { bloqueada: x.bloqueada ? undefined : true }))}
                >
                  {x.bloqueada ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3 opacity-50" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {c && (
        <section aria-label="Propiedades" className="space-y-2 rounded-md border border-border p-2">
          <p className={etiqueta}>{nombreCapa(c)}</p>

          {c.tipo === 'texto' && (
            <>
              <textarea
                rows={3}
                className={input}
                aria-label="Texto"
                value={c.texto}
                onChange={(e) => cambiar({ texto: e.target.value }, 'texto')}
              />
              <label className="block">
                <span className={etiqueta}>Frase resaltada</span>
                <input
                  className={input}
                  value={c.acento ?? ''}
                  onChange={(e) => cambiar({ acento: e.target.value || undefined }, 'acento')}
                  placeholder="Una palabra del texto"
                />
              </label>
              <label className="block">
                <span className={etiqueta}>Tamaño · {c.tam}px</span>
                <input
                  type="range"
                  min={20}
                  max={260}
                  value={c.tam}
                  className="w-full"
                  onChange={(e) => cambiar({ tam: Number(e.target.value) }, 'tam')}
                />
              </label>
              <div className="grid grid-cols-2 gap-1">
                <label>
                  <span className={etiqueta}>Tipografía</span>
                  <select
                    className={input}
                    value={c.fuente ?? ''}
                    onChange={(e) =>
                      cambiar({ fuente: (e.target.value || undefined) as (typeof FUENTES_IG)[number] | undefined })
                    }
                  >
                    <option value="">De la plantilla</option>
                    {FUENTES_IG.map((f) => (
                      <option key={f} value={f}>
                        {ETIQUETA_FUENTE[f]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={etiqueta}>Caja</span>
                  <select
                    className={input}
                    value={c.caja}
                    onChange={(e) => cambiar({ caja: e.target.value as CajaTexto })}
                  >
                    {CAJAS_TEXTO.map((k) => (
                      <option key={k} value={k}>
                        {ETIQUETA_CAJA[k]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {c.caja === 'sin' && (
                <label className="block">
                  <span className={etiqueta}>Color</span>
                  <select
                    className={input}
                    value={c.color}
                    onChange={(e) => cambiar({ color: e.target.value as 'blanco' | 'negro' | 'marca' })}
                  >
                    <option value="blanco">Blanco</option>
                    <option value="negro">Negro</option>
                    <option value="marca">Color de marca</option>
                  </select>
                </label>
              )}
              <div
                className="inline-flex rounded-md border border-border p-0.5"
                role="group"
                aria-label="Alineación del texto"
              >
                {(['izq', 'centro', 'der'] as const).map((a) => (
                  <button
                    key={a}
                    aria-pressed={c.alinea === a}
                    onClick={() => cambiar({ alinea: a })}
                    className={`rounded px-2 py-0.5 text-3xs ${c.alinea === a ? 'bg-brand-600 text-white' : 'text-muted-foreground'}`}
                  >
                    {{ izq: 'Izquierda', centro: 'Centro', der: 'Derecha' }[a]}
                  </button>
                ))}
              </div>
            </>
          )}

          {c.tipo === 'imagen' && (
            <>
              {c.pedido ? (
                <p className="text-3xs text-muted-foreground">
                  Material real: «{c.pedido.titulo}». Se sube en «Fotos y vídeos» → material pedido.
                </p>
              ) : (
                <label className="block">
                  <span className={etiqueta}>Foto</span>
                  <select
                    className={input}
                    value={c.foto ?? ''}
                    onChange={(e) => cambiar({ foto: Number(e.target.value) || undefined, url: undefined })}
                  >
                    <option value="">Sin foto</option>
                    {p.medios.map((m, i) => (
                      <option key={m.url} value={i + 1}>
                        Foto {i + 1} · {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="grid grid-cols-2 gap-1">
                <label>
                  <span className={etiqueta}>Ajuste</span>
                  <select
                    className={input}
                    value={c.ajuste}
                    onChange={(e) => cambiar({ ajuste: e.target.value as 'cubrir' | 'contener' })}
                  >
                    <option value="cubrir">Rellenar (recorta)</option>
                    <option value="contener">Entera</option>
                  </select>
                </label>
                <label>
                  <span className={etiqueta}>Esquinas · {c.radio}</span>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    value={c.radio}
                    className="w-full"
                    onChange={(e) => cambiar({ radio: Number(e.target.value) }, 'radio')}
                  />
                </label>
              </div>
              {c.ajuste === 'cubrir' && (
                <div className="grid grid-cols-2 gap-1">
                  <label>
                    <span className={etiqueta}>Encuadre ↔</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={c.enfoque?.x ?? 50}
                      className="w-full"
                      onChange={(e) =>
                        cambiar({ enfoque: { x: Number(e.target.value), y: c.enfoque?.y ?? 50 } }, 'enfoque')
                      }
                    />
                  </label>
                  <label>
                    <span className={etiqueta}>Encuadre ↕</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={c.enfoque?.y ?? 50}
                      className="w-full"
                      onChange={(e) =>
                        cambiar({ enfoque: { x: c.enfoque?.x ?? 50, y: Number(e.target.value) } }, 'enfoque')
                      }
                    />
                  </label>
                </div>
              )}
              <div className="flex gap-3 text-3xs">
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={c.marco} onChange={(e) => cambiar({ marco: e.target.checked })} />{' '}
                  Marco blanco
                </label>
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={c.sombra} onChange={(e) => cambiar({ sombra: e.target.checked })} />{' '}
                  Sombra
                </label>
              </div>
            </>
          )}

          {c.tipo === 'emoji' && (
            <>
              <label className="block">
                <span className={etiqueta}>Emoji</span>
                <input
                  className={input}
                  value={c.emoji}
                  maxLength={8}
                  onChange={(e) => cambiar({ emoji: e.target.value || '⭐' })}
                />
              </label>
              <label className="block">
                <span className={etiqueta}>Tamaño · {c.tam}px</span>
                <input
                  type="range"
                  min={40}
                  max={400}
                  value={c.tam}
                  className="w-full"
                  onChange={(e) =>
                    cambiar({ tam: Number(e.target.value), w: Math.round(Number(e.target.value) * 1.2) }, 'tam')
                  }
                />
              </label>
            </>
          )}

          {c.tipo === 'sticker' && (
            <>
              <label className="block">
                <span className={etiqueta}>Tipo</span>
                <select
                  className={input}
                  value={c.sticker}
                  onChange={(e) => cambiar({ sticker: e.target.value as 'pregunta' | 'escribe' | 'encuesta' })}
                >
                  <option value="pregunta">Pregunta</option>
                  <option value="encuesta">Encuesta (2 opciones)</option>
                  <option value="escribe">Escribe una respuesta</option>
                </select>
              </label>
              {c.sticker !== 'encuesta' && (
                <label className="block">
                  <span className={etiqueta}>Cabecera</span>
                  <input
                    className={input}
                    value={c.cabecera ?? ''}
                    onChange={(e) => cambiar({ cabecera: e.target.value || undefined }, 'cab')}
                  />
                </label>
              )}
              <label className="block">
                <span className={etiqueta}>{c.sticker === 'encuesta' ? 'Pregunta' : 'Texto'}</span>
                <input
                  className={input}
                  value={c.texto ?? ''}
                  onChange={(e) => cambiar({ texto: e.target.value || undefined }, 'texto')}
                />
              </label>
              {c.sticker === 'encuesta' && (
                <div className="grid grid-cols-2 gap-1">
                  {[0, 1].map((i) => (
                    <input
                      key={i}
                      className={input}
                      aria-label={`Opción ${i + 1}`}
                      value={c.opciones?.[i] ?? (i === 0 ? 'Sí' : 'No')}
                      onChange={(e) => {
                        const o: [string, string] = [c.opciones?.[0] ?? 'Sí', c.opciones?.[1] ?? 'No']
                        o[i] = e.target.value || (i === 0 ? 'Sí' : 'No')
                        cambiar({ opciones: o }, 'op')
                      }}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {c.tipo === 'forma' && (
            <>
              <div className="grid grid-cols-2 gap-1">
                <label>
                  <span className={etiqueta}>Forma</span>
                  <select
                    className={input}
                    value={c.forma}
                    onChange={(e) => cambiar({ forma: e.target.value as (typeof FORMAS)[number] })}
                  >
                    {FORMAS.map((f) => (
                      <option key={f} value={f}>
                        {ETIQUETA_FORMA[f]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className={etiqueta}>Color</span>
                  <select
                    className={input}
                    value={c.color}
                    onChange={(e) => cambiar({ color: e.target.value as (typeof COLORES_FORMA)[number] })}
                  >
                    {COLORES_FORMA.map((k) => (
                      <option key={k} value={k}>
                        {ETIQUETA_COLOR[k]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className={etiqueta}>Grosor · {c.grosor}px</span>
                <input
                  type="range"
                  min={3}
                  max={30}
                  value={c.grosor}
                  className="w-full"
                  onChange={(e) => cambiar({ grosor: Number(e.target.value) }, 'grosor')}
                />
              </label>
            </>
          )}

          <div className="grid grid-cols-2 gap-1">
            <label>
              <span className={etiqueta}>Opacidad · {Math.round((c.opacidad ?? 1) * 100)}%</span>
              <input
                type="range"
                min={10}
                max={100}
                value={Math.round((c.opacidad ?? 1) * 100)}
                className="w-full"
                onChange={(e) =>
                  cambiar(
                    { opacidad: Number(e.target.value) >= 100 ? undefined : Number(e.target.value) / 100 },
                    'opac'
                  )
                }
              />
            </label>
            <label>
              <span className={etiqueta}>Giro · {c.rot ?? 0}°</span>
              <input
                type="range"
                min={-180}
                max={180}
                value={c.rot ?? 0}
                className="w-full"
                onChange={(e) => cambiar({ rot: Number(e.target.value) || undefined }, 'rot')}
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-0.5" role="group" aria-label="Alinear en la historia">
            {(
              [
                ['izquierda', AlignStartVertical, 'Izquierda'],
                ['centro', AlignCenterVertical, 'Centrar'],
                ['derecha', AlignEndVertical, 'Derecha'],
                ['arriba', AlignStartHorizontal, 'Arriba'],
                ['medio', AlignCenterHorizontal, 'Al medio'],
                ['abajo', AlignEndHorizontal, 'Abajo'],
              ] as const
            ).map(([modo, Icono, nombre]) => (
              <button
                key={modo}
                className="rounded border border-border p-1 hover:bg-muted"
                onClick={() => alinearCon(modo)}
                aria-label={nombre}
                title={nombre}
              >
                <Icono className="h-3 w-3" />
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            <button className={boton} onClick={() => onCambio(ordenar(capas, c.id, 'subir'))} title="Subir una capa">
              <ArrowUp className="h-3 w-3" /> Subir
            </button>
            <button className={boton} onClick={() => onCambio(ordenar(capas, c.id, 'bajar'))} title="Bajar una capa">
              <ArrowDown className="h-3 w-3" /> Bajar
            </button>
            <button className={boton} onClick={() => onCambio(ordenar(capas, c.id, 'frente'))}>
              Al frente
            </button>
            <button className={boton} onClick={() => onCambio(ordenar(capas, c.id, 'fondo'))}>
              Al fondo
            </button>
            <button
              className={boton}
              onClick={() => {
                const r = duplicar(capas, c.id)
                if (r.nueva) {
                  onCambio(r.capas)
                  p.onSeleccion(r.nueva.id)
                }
              }}
            >
              <Copy className="h-3 w-3" /> Duplicar
            </button>
            <button
              className={`${boton} text-destructive`}
              onClick={() => {
                p.onSeleccion(null)
                onCambio(sinCapa(capas, c.id))
              }}
            >
              <Trash2 className="h-3 w-3" /> Borrar
            </button>
          </div>
        </section>
      )}

      <section aria-label="Fondo" className="space-y-2 rounded-md border border-border p-2">
        <p className={etiqueta}>Foto de fondo</p>
        <label className="block">
          <select
            className={input}
            aria-label="Foto de fondo"
            value={spec.fondo === 'liso' ? 'liso' : (spec.foto ?? '')}
            onChange={(e) => {
              const v = e.target.value
              p.onSpec(
                v === 'liso'
                  ? { ...spec, fondo: 'liso', foto: undefined, fondoPos: undefined }
                  : { ...spec, fondo: 'foto', foto: Number(v) || undefined, fondoPos: undefined }
              )
            }}
          >
            <option value="">Automática</option>
            {p.medios.map((m, i) => (
              <option key={m.url} value={i + 1}>
                Foto {i + 1} · {m.name}
              </option>
            ))}
            <option value="liso">Fondo liso de la marca</option>
          </select>
        </label>
        {spec.fondo !== 'liso' && !sinFotos && (
          <>
            <button
              className={`${boton} w-full ${p.modoFondo ? 'bg-brand-600 text-white' : ''}`}
              aria-pressed={p.modoFondo}
              onClick={() => p.onModoFondo(!p.modoFondo)}
            >
              {p.modoFondo ? 'Terminar de reencuadrar' : 'Reencuadrar la foto (arrastrar)'}
            </button>
            <label className="block">
              <span className={etiqueta}>Zoom · {fondoPos.zoom.toFixed(2)}×</span>
              <input
                type="range"
                min={100}
                max={300}
                value={Math.round(fondoPos.zoom * 100)}
                className="w-full"
                onChange={(e) =>
                  p.onSpec({ ...spec, fondoPos: { ...fondoPos, zoom: Number(e.target.value) / 100 } }, 'zoom')
                }
              />
            </label>
          </>
        )}
        <label className="block">
          <span className={etiqueta}>
            Oscurecer · {spec.velo ?? 'auto'}
            {spec.velo !== undefined ? '%' : ''}
          </span>
          <input
            type="range"
            min={0}
            max={90}
            step={5}
            value={spec.velo ?? 40}
            className="w-full"
            onChange={(e) => p.onSpec({ ...spec, velo: Number(e.target.value) }, 'velo')}
          />
        </label>
        {spec.velo !== undefined && (
          <button className={boton} onClick={() => p.onSpec({ ...spec, velo: undefined })}>
            Oscurecimiento automático
          </button>
        )}
        {p.otrasHistorias.length > 0 && !sinFotos && (
          <label className="block">
            <span className={etiqueta}>Intercambiar foto con…</span>
            <select
              className={input}
              value=""
              onChange={(e) => e.target.value !== '' && p.onIntercambiar(Number(e.target.value))}
            >
              <option value="">Elige otra historia</option>
              {p.otrasHistorias.map((h) => (
                <option key={h.indice} value={h.indice}>
                  Historia {h.indice + 1}
                  {h.titulo ? ` · ${h.titulo.slice(0, 22)}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      <button className={`${boton} w-full`} onClick={p.onVolverAPlantilla}>
        Volver a la plantilla (se pierden las posiciones)
      </button>
    </div>
  )
}
