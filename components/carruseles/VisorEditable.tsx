'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, GripVertical, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { CarouselPreview } from './CarouselPreview'
import { EditorCapas } from './lienzo/EditorCapas'
import { PanelCapas } from './lienzo/PanelCapas'
import { useHistorial } from './lienzo/useHistorial'
import type { MedidaCapa } from './SlideRenderer'
import { conTextosEditados, textosEditables } from '@/lib/carruseles/historias/edicion'
import { capasConTextos, capasDeSpec, conCapas, type Capa } from '@/lib/carruseles/historias/capas'
import { intercambiarFondos } from '@/lib/carruseles/historias/fotos'
import {
  FUENTES_IG,
  LAYOUTS,
  conLayout,
  leerSpec,
  posicionPx,
  renderHistoria,
  type HistoriaSpec,
} from '@/lib/carruseles/historias/layouts'
import { leerSpecDeHtml, pedidosPendientes } from '@/lib/carruseles/historias/pedidos'
import { debeRecargarFormulario } from '@/lib/carruseles/historias/sincronia'
import { SEGURA_POR_PLATAFORMA, type Plataforma } from '@/lib/carruseles/historias/estilo-nativo'
import { SEGUNDOS_POR_HISTORIA, revisarSecuencia } from '@/lib/carruseles/historias/revision'
import { MODOS_VARIANTE, type ModoVariante, type Variante } from '@/lib/carruseles/historias/variantes'
import { tipoDeMedio } from '@/lib/carruseles/almacen'
import type { EstiloId } from '@/lib/carruseles/estilos'
import {
  DEFAULT_BRAND,
  type AspectRatio,
  type BrandConfig,
  type ReferenceImage,
  type Slide,
} from '@/lib/carruseles/types'
import { useTenant } from '@/lib/tenant-context'

interface Props {
  projectId: string
  slides: Slide[]
  aspectRatio: AspectRatio
  activeIndex: number
  onActiveChange: (i: number) => void
  referenceImages: ReferenceImage[]
  /** Se llama tras guardar un cambio para volver a leer el proyecto. */
  onGuardado: () => void
  /** Mientras la IA genera no se edita. */
  bloqueado: boolean
  mostrarPanel: boolean
}

const input = 'w-full rounded-md border border-border bg-background px-2 py-1 text-sm'
const etiqueta = 'text-3xs font-semibold uppercase tracking-wider text-muted-foreground'

/**
 * Vista previa con edición mínima: las historias nuevas se editan por campos (texto, acento, fuente, caja, foto, posición),
 * se arrastra el bloque de texto en vertical y se suelta una foto sobre la historia; el resto de slides, por lista de textos.
 * Todo se recompone en el navegador y se guarda sin llamar a la IA.
 * «Edición libre» (modo pro) convierte la historia en capas que se arrastran, redimensionan y giran (`lienzo/`).
 */
export function VisorEditable({
  projectId,
  slides,
  aspectRatio,
  activeIndex,
  onActiveChange,
  referenceImages,
  onGuardado,
  bloqueado,
  mostrarPanel,
}: Props) {
  const tenant = useTenant()
  const slide = slides[activeIndex]
  const previa = useMemo(() => (slide ? leerSpecDeHtml(slide.html) : null), [slide])
  const [brand, setBrand] = useState<BrandConfig>(DEFAULT_BRAND)
  const [spec, setSpec] = useState<HistoriaSpec | null>(null)
  const [cambios, setCambios] = useState<Record<number, string>>({})
  const [aviso, setAviso] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [guias, setGuias] = useState(false)
  const [variantes, setVariantes] = useState<{ slideId: string; items: Variante[] } | null>(null)
  const [pidiendo, setPidiendo] = useState<ModoVariante | null>(null)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Qué slide representa el formulario y qué HTML guardamos nosotros: para recargarlo solo cuando el cambio viene de fuera.
  const formId = useRef<string | null>(null)
  const guardados = useRef(new Set<string>())
  // Slides que ya tienen su versión para «deshacer» en esta sesión: el autoguardado no llena el historial.
  const versionadas = useRef(new Set<string>())
  const pendiente = useRef<((alSalir?: boolean) => void) | null>(null)
  // Modo libre (capas): historial de deshacer, elemento elegido, medidas reales de cada capa y vista inmediata.
  const {
    registrar: registrarHistorial,
    deshacer: deshacerHistorial,
    rehacer: rehacerHistorial,
    limpiar: limpiarHistorial,
    puedeDeshacer,
    puedeRehacer,
  } = useHistorial<HistoriaSpec>()
  const [seleccion, setSeleccion] = useState<string | null>(null)
  const [modoFondo, setModoFondo] = useState(false)
  const [medidas, setMedidas] = useState<Record<string, MedidaCapa>>({})
  const [docSlide, setDocSlide] = useState<Document | null>(null)
  const [vistaLocal, setVistaLocal] = useState<{ slideId: string; html: string } | null>(null)
  const edicionSlide = useMemo(
    () => ({
      onDocumento: setDocSlide,
      onMedidas: (m: Record<string, MedidaCapa>) =>
        setMedidas((prev) => (JSON.stringify(prev) === JSON.stringify(m) ? prev : m)),
    }),
    []
  )

  useEffect(() => {
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

  // Se recarga el formulario al cambiar de slide o si el HTML cambia por algo que no hemos guardado nosotros (p. ej. la IA).
  // Las lecturas tardías de nuestros propios guardados no lo recargan: así no se pierde lo que se está escribiendo.
  useEffect(() => {
    if (!slide) return
    if (
      !debeRecargarFormulario({
        formId: formId.current,
        slideId: slide.id,
        html: slide.html,
        guardados: guardados.current,
      })
    )
      return
    formId.current = slide.id
    setSpec(previa?.spec ?? null)
    setCambios({})
    setAviso(null)
    limpiarHistorial()
    setSeleccion(null)
    setModoFondo(false)
    setVistaLocal(null)
  }, [slide, previa, limpiarHistorial])

  // La vista inmediata del modo libre se retira cuando lo guardado la alcanza o se cambia de historia.
  useEffect(() => {
    if (vistaLocal && slide && (slide.id !== vistaLocal.slideId || slide.html === vistaLocal.html)) setVistaLocal(null)
  }, [slide, vistaLocal])

  const medios = referenceImages.filter((r) => !r.pedido)
  const pedidos = useMemo(
    () => Object.fromEntries(referenceImages.filter((r) => r.pedido).map((r) => [r.pedido as string, r.url])),
    [referenceImages]
  )

  const guardarHtml = useCallback(
    async (html: string, opciones: { alSalir?: boolean } = {}) => {
      if (!slide) return
      setGuardando(true)
      try {
        const res = await fetch(`/api/${tenant}/evergreen/carruseles/${projectId}/slides/${slide.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html, sinVersion: versionadas.current.has(slide.id) }),
          // keepalive solo para el guardado al salir: los navegadores lo rechazan con cuerpos de más de 64 KiB.
          keepalive: opciones.alSalir === true,
        })
        if (!res.ok) throw new Error('No se pudo guardar')
        versionadas.current.add(slide.id)
        guardados.current.add(html)
        if (guardados.current.size > 30) guardados.current.delete(guardados.current.values().next().value as string)
        onGuardado()
      } catch (e) {
        toast.error((e as Error).message)
      } finally {
        setGuardando(false)
      }
    },
    [slide, tenant, projectId, onGuardado]
  )

  const estiloDe = (p: typeof previa): EstiloId => {
    const e = p?.estilo
    return e === 'editorial' || e === 'limpio' || e === 'marca' ? e : 'nativo'
  }
  /** Datos con los que se compone la historia número `indice` (la activa o cualquier otra con su propia especificación). */
  const contexto = (indice: number, p: typeof previa = previa) => ({
    brand,
    estilo: estiloDe(p),
    media: medios.map((m) => ({ url: m.url, name: m.name, kind: tipoDeMedio(m.url) })),
    pedidos,
    hoy: p?.hoy ?? new Date(),
    indice,
    total: slides.length,
  })

  /**
   * Recompone la historia con la nueva especificación y la guarda (con pausa para no guardar cada tecla).
   * En modo libre cada cambio entra en el historial de deshacer (`clave` agrupa los seguidos del mismo tipo) y se ve al instante.
   */
  const cambiarSpec = (
    siguiente: HistoriaSpec,
    inmediato = false,
    opciones: { clave?: string; sinHistorial?: boolean } = {}
  ) => {
    if (!opciones.sinHistorial && spec && (spec.capas || siguiente.capas)) registrarHistorial(spec, opciones.clave)
    setSpec(siguiente)
    const r = leerSpec(siguiente)
    if (!r.ok) return setAviso(r.error)
    setAviso(null)
    const html = renderHistoria(r.spec, contexto(activeIndex))
    if (r.spec.capas && slide) setVistaLocal({ slideId: slide.id, html })
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = null
    pendiente.current = null
    if (inmediato) return void guardarHtml(html)
    pendiente.current = (alSalir) => void guardarHtml(html, { alSalir })
    temporizador.current = setTimeout(() => {
      temporizador.current = null
      pendiente.current?.()
      pendiente.current = null
    }, 600)
  }

  // Al salir, lo que esté esperando su pausa se guarda en vez de perderse.
  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current)
      pendiente.current?.(true)
    },
    []
  )

  // Arrastrar el bloque de texto en vertical: solo se recompone al soltar.
  const plataforma: Plataforma = spec?.plataforma ?? 'instagram'
  const libre = Boolean(spec?.capas)
  const asa =
    spec && !libre ? (
      <AsaTexto
        plataforma={plataforma}
        posicion={spec.posicion}
        posicionInicial={posicionAproximada(spec.layout, medios.length > 0)}
        onSoltar={(p) => cambiarSpec({ ...spec, posicion: p }, true)}
        deshabilitado={bloqueado}
      />
    ) : null
  const sueltaMedio =
    spec && !libre && !bloqueado && medios.length > 0
      ? (n: number) => cambiarSpec({ ...spec, foto: n, fondo: 'foto' }, true)
      : undefined
  const slidesVista = useMemo(
    () =>
      vistaLocal ? slides.map((x) => (x.id === vistaLocal.slideId ? { ...x, html: vistaLocal.html } : x)) : slides,
    [slides, vistaLocal]
  )
  const otrasHistorias = useMemo(
    () =>
      slides.flatMap((x, i) => {
        const sp = i === activeIndex ? null : leerSpecDeHtml(x.html)?.spec
        return sp ? [{ indice: i, titulo: sp.titulo ?? sp.texto ?? '' }] : []
      }),
    [slides, activeIndex]
  )

  const activarLibre = () => {
    if (!spec) return
    cambiarSpec({ ...spec, capas: capasDeSpec(spec, { estilo: estiloDe(previa), hayFoto: medios.length > 0 }) }, true)
    toast.success('Modo libre: arrastra cada elemento. Ctrl/⌘ Z deshace.')
  }
  const volverAPlantilla = () => {
    toast('¿Volver a la plantilla? Se pierden las posiciones.', {
      action: {
        label: 'Volver',
        onClick: () => {
          if (spec) cambiarSpec({ ...spec, capas: undefined }, true, { sinHistorial: true })
          limpiarHistorial()
          setSeleccion(null)
          setModoFondo(false)
        },
      },
    })
  }
  const cambiarCapas = (capas: Capa[], clave?: string) => {
    if (spec) cambiarSpec(conCapas(spec, capas), false, { clave })
  }
  const deshacer = () => {
    if (!spec) return
    const prev = deshacerHistorial(spec)
    if (prev) cambiarSpec(prev, true, { sinHistorial: true })
  }
  const rehacer = () => {
    if (!spec) return
    const sig = rehacerHistorial(spec)
    if (sig) cambiarSpec(sig, true, { sinHistorial: true })
  }
  /** Intercambia la foto de fondo (con su encuadre) de esta historia con la de otra, y guarda las dos. */
  const intercambiar = async (j: number) => {
    const otra = slides[j]
    const pj = otra ? leerSpecDeHtml(otra.html) : null
    if (!spec || !otra || !pj) return
    const par = intercambiarFondos({ spec, ctx: contexto(activeIndex) }, { spec: pj.spec, ctx: contexto(j, pj) })
    if (!par) return void toast.error('No hay fotos que intercambiar')
    cambiarSpec(par[0], true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/carruseles/${projectId}/slides/${otra.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: renderHistoria(par[1], contexto(j, pj)) }),
      })
      if (!res.ok) throw new Error('No se pudo guardar la otra historia')
      toast.success(`Fotos intercambiadas con la historia ${j + 1}`)
      onGuardado()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const revision = useMemo(() => {
    // La revisión numera solo las historias con especificación; se traduce al número real de slide.
    const conSpec = slides.flatMap((s, i) => {
      const sp = leerSpecDeHtml(s.html)?.spec
      return sp ? [{ i, sp }] : []
    })
    return {
      total: conSpec.length,
      hallazgos: revisarSecuencia(
        conSpec.map((x) => x.sp),
        {
          hayMedios: medios.length > 0,
          pendientes: new Set(pedidosPendientes(slides).map((p) => p.clave)).size,
        }
      ).map((h) => (h.historia ? { ...h, historia: (conSpec[h.historia - 1]?.i ?? h.historia - 1) + 1 } : h)),
    }
  }, [slides, medios.length])

  const cambiarPlataforma = async (p: Plataforma) => {
    try {
      localStorage.setItem(`carrusel-plataforma-${projectId}`, p)
    } catch {
      /* se aplica igualmente a las historias existentes */
    }
    const res = await fetch(`/api/${tenant}/evergreen/carruseles/recomponer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, plataforma: p }),
    })
    if (!res.ok) toast.error('No se pudo cambiar de plataforma')
    onGuardado()
  }

  const pedirVariantes = async (modo: ModoVariante) => {
    if (!slide) return
    const id = slide.id
    setPidiendo(modo)
    setVariantes(null)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/carruseles/variantes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, slideId: slide.id, modo }),
      })
      const j = (await res.json().catch(() => ({}))) as { opciones?: Variante[]; error?: string }
      if (!res.ok || !j.opciones) throw new Error(j.error || 'No se pudieron generar variantes')
      setVariantes({ slideId: id, items: j.opciones })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setPidiendo(null)
    }
  }

  const textos = useMemo(() => (slide && !previa ? textosEditables(slide.html) : []), [slide, previa])

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <CarouselPreview
        slides={slidesVista}
        aspectRatio={aspectRatio}
        activeIndex={activeIndex}
        onActiveChange={onActiveChange}
        overlay={
          <>
            {guias && <GuiasSeguras plataforma={plataforma} />}
            {asa}
            {spec?.capas && (
              <EditorCapas
                capas={spec.capas}
                seleccion={seleccion}
                onSeleccion={setSeleccion}
                onCambio={cambiarCapas}
                medidas={medidas}
                doc={docSlide}
                plataforma={plataforma}
                deshabilitado={bloqueado}
                modoFondo={modoFondo}
                fondoPos={spec.fondoPos}
                onFondoPos={(p) =>
                  cambiarSpec({ ...spec, fondoPos: p.x === 50 && p.y === 50 && p.zoom === 1 ? undefined : p })
                }
                onDeshacer={deshacer}
                onRehacer={rehacer}
              />
            )}
          </>
        }
        onDropMedio={libre ? undefined : sueltaMedio}
        editable={libre ? edicionSlide : undefined}
      />
      {mostrarPanel && slide && (
        <aside
          className="w-72 shrink-0 space-y-3 overflow-y-auto border-l border-border bg-card p-3"
          aria-label="Editar slide"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Editar {spec ? 'historia' : 'slide'}</h3>
            {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          {bloqueado && <p className="text-3xs text-amber-500">La IA está generando: edita cuando termine.</p>}
          {revision.total > 0 && (
            <section aria-label="Revisión de la secuencia" className="rounded-md border border-border p-2">
              <p className={etiqueta}>Revisión · ≈{revision.total * SEGUNDOS_POR_HISTORIA} s de secuencia</p>
              {revision.hallazgos.length === 0 ? (
                <p className="mt-1 flex items-center gap-1 text-3xs text-emerald-500">
                  <CheckCircle2 className="h-3 w-3" /> Lista para publicar
                </p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {revision.hallazgos.map((h, i) => (
                    <li key={i}>
                      <button
                        onClick={() => h.historia && onActiveChange(h.historia - 1)}
                        className="flex w-full items-start gap-1 text-left text-3xs text-muted-foreground hover:text-foreground"
                      >
                        <AlertTriangle
                          className={`mt-px h-3 w-3 shrink-0 ${h.nivel === 'error' ? 'text-destructive' : 'text-amber-500'}`}
                        />
                        <span>
                          {h.historia ? `H${h.historia}: ` : ''}
                          {h.mensaje}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {(spec || revision.total > 0) && (
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex rounded-md border border-border p-0.5" role="group" aria-label="Publicar en">
                {(['instagram', 'tiktok'] as const).map((p) => (
                  <button
                    key={p}
                    aria-pressed={plataforma === p}
                    disabled={bloqueado}
                    onClick={() => void cambiarPlataforma(p)}
                    className={`rounded px-2 py-0.5 text-3xs font-medium ${plataforma === p ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {p === 'instagram' ? 'Instagram' : 'TikTok'}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1 text-3xs text-muted-foreground">
                <input type="checkbox" checked={guias} onChange={(e) => setGuias(e.target.checked)} /> Guías de la app
              </label>
            </div>
          )}
          {spec && (
            <section aria-label="Variantes con IA">
              <p className={etiqueta}>Variantes con IA</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {MODOS_VARIANTE.map((m) => (
                  <button
                    key={m}
                    disabled={bloqueado || pidiendo !== null}
                    onClick={() => void pedirVariantes(m)}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-3xs hover:bg-muted disabled:opacity-50"
                  >
                    {pidiendo === m ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {{ ganchos: '3 ganchos', otra: 'Otra versión', corta: 'Más corto' }[m]}
                  </button>
                ))}
              </div>
              {variantes && variantes.slideId === slide.id && (
                <ul className="mt-2 space-y-1">
                  {variantes.items.map((v, i) => (
                    <li key={i}>
                      <button
                        onClick={() => {
                          cambiarSpec(
                            capasConTextos({
                              ...spec,
                              titulo: v.titulo ?? spec.titulo,
                              acento: v.acento,
                              texto: v.texto ?? spec.texto,
                            }),
                            true
                          )
                          setVariantes(null)
                        }}
                        className="w-full rounded-md border border-border p-1.5 text-left text-3xs hover:border-brand-400"
                      >
                        <b className="block text-xs">{v.titulo}</b>
                        {v.texto && <span className="text-muted-foreground">{v.texto}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {spec ? (
            spec.capas ? (
              <PanelCapas
                spec={spec}
                capas={spec.capas}
                seleccion={seleccion}
                onSeleccion={setSeleccion}
                onCambio={cambiarCapas}
                onSpec={(sig, clave) => cambiarSpec(sig, false, { clave })}
                medidas={medidas}
                medios={medios}
                plataforma={plataforma}
                modoFondo={modoFondo}
                onModoFondo={setModoFondo}
                otrasHistorias={otrasHistorias}
                onIntercambiar={(j) => void intercambiar(j)}
                onVolverAPlantilla={volverAPlantilla}
                puedeDeshacer={puedeDeshacer}
                puedeRehacer={puedeRehacer}
                onDeshacer={deshacer}
                onRehacer={rehacer}
              />
            ) : (
              <>
                <button
                  disabled={bloqueado}
                  onClick={activarLibre}
                  className="w-full rounded-md border border-brand-400 bg-brand-500/10 px-3 py-1.5 text-xs font-medium hover:bg-brand-500/20 disabled:opacity-50"
                >
                  Edición libre: arrastrar y soltar
                </button>
                <CamposHistoria
                  spec={spec}
                  onCambio={cambiarSpec}
                  medios={medios}
                  deshabilitado={bloqueado}
                  aviso={aviso}
                />
              </>
            )
          ) : textos.length > 0 ? (
            <div className="space-y-2">
              {textos.map((t) => (
                <div key={t.indice}>
                  <label className={etiqueta}>Texto {t.indice + 1}</label>
                  <textarea
                    rows={Math.min(4, Math.max(1, Math.ceil(t.texto.length / 28)))}
                    className={input}
                    disabled={bloqueado}
                    value={cambios[t.indice] ?? t.texto}
                    onChange={(e) => setCambios({ ...cambios, [t.indice]: e.target.value })}
                  />
                </div>
              ))}
              <button
                disabled={bloqueado || guardando || Object.keys(cambios).length === 0}
                onClick={() => void guardarHtml(conTextosEditados(slide.html, cambios))}
                className="w-full rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
              >
                Guardar textos
              </button>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Esta slide no tiene texto editable.</p>
          )}
        </aside>
      )}
    </div>
  )
}

/** Posición (0-100) aproximada del bloque de texto antes de que tenga una propia: las plantillas con foto lo ponen abajo. */
const posicionAproximada = (layout: HistoriaSpec['layout'], hayMedios: boolean): number =>
  layout === 'foto_texto' || (layout === 'portada' && hayMedios) ? 72 : 38

/** Zonas que la interfaz de cada red tapa: lo que se pone ahí no se ve. Aproximadas (las redes cambian su interfaz). */
function GuiasSeguras({ plataforma }: { plataforma: Plataforma }) {
  const z = SEGURA_POR_PLATAFORMA[plataforma]
  const banda = 'pointer-events-none absolute bg-red-500/25 text-center text-3xs text-white'
  return (
    <>
      <div className={`${banda} left-0 right-0 top-0`} style={{ height: `${(z.arriba / 1920) * 100}%` }}>
        Interfaz de {plataforma === 'instagram' ? 'Instagram' : 'TikTok'}
      </div>
      <div className={`${banda} bottom-0 left-0 right-0`} style={{ height: `${(z.abajo / 1920) * 100}%` }} />
      <div className={`${banda} bottom-0 right-0 top-0`} style={{ width: `${(z.derecha / 1080) * 100}%` }} />
    </>
  )
}

/** Asa para arrastrar el bloque de texto arriba y abajo dentro de la zona segura de la historia. */
function AsaTexto({
  plataforma,
  posicion,
  posicionInicial,
  onSoltar,
  deshabilitado,
}: {
  plataforma: Plataforma
  posicion: number | undefined
  /** Dónde está el texto cuando aún no tiene posición propia (aproximado, según la plantilla). */
  posicionInicial: number
  onSoltar: (p: number) => void
  deshabilitado: boolean
}) {
  const [arrastrando, setArrastrando] = useState<number | null>(null)
  const actual = posicion ?? posicionInicial
  const p = arrastrando ?? actual
  const y = posicionPx(p, plataforma)

  const calcular = (e: React.PointerEvent<HTMLDivElement>): number => {
    const caja = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    const py = ((e.clientY - caja.top) / caja.height) * 1920
    return Math.min(
      94,
      Math.max(
        6,
        Math.round(((py - posicionPx(0, plataforma)) / (posicionPx(100, plataforma) - posicionPx(0, plataforma))) * 100)
      )
    )
  }

  if (deshabilitado) return null
  return (
    <div
      role="slider"
      aria-label="Mover el texto arriba o abajo"
      aria-valuemin={6}
      aria-valuemax={94}
      aria-valuenow={p}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp') onSoltar(Math.max(6, p - 4))
        if (e.key === 'ArrowDown') onSoltar(Math.min(94, p + 4))
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setArrastrando(actual) // un clic sin mover no cambia nada
      }}
      onPointerMove={(e) => arrastrando !== null && setArrastrando(calcular(e))}
      onPointerUp={(e) => {
        const destino = arrastrando !== null ? calcular(e) : null
        setArrastrando(null)
        if (destino !== null && Math.abs(destino - actual) >= 2) onSoltar(destino)
      }}
      onPointerCancel={() => setArrastrando(null)}
      className="absolute left-0 right-0 z-10 flex cursor-ns-resize touch-none items-center"
      style={{ top: `${(y / 1920) * 100}%`, transform: 'translateY(-50%)' }}
      title="Arrastra para mover el texto"
    >
      <div className="h-px flex-1 border-t border-dashed border-white/70" />
      <div className="mx-1 flex items-center gap-1 rounded-full bg-brand-600 px-2 py-0.5 text-3xs font-medium text-white shadow">
        <GripVertical className="h-3 w-3" /> mover texto
      </div>
      <div className="h-px flex-1 border-t border-dashed border-white/70" />
    </div>
  )
}

function CamposHistoria({
  spec,
  onCambio,
  medios,
  deshabilitado,
  aviso,
}: {
  spec: HistoriaSpec
  onCambio: (s: HistoriaSpec) => void
  medios: ReferenceImage[]
  deshabilitado: boolean
  aviso: string | null
}) {
  const set = <K extends keyof HistoriaSpec>(k: K, v: HistoriaSpec[K] | '') =>
    onCambio({ ...spec, [k]: v === '' ? undefined : v })
  const campo = (k: 'titulo' | 'acento' | 'texto' | 'cifra', nombre: string, filas = 0) => (
    <div key={k}>
      <label className={etiqueta}>{nombre}</label>
      {filas ? (
        <textarea
          rows={filas}
          className={input}
          disabled={deshabilitado}
          value={spec[k] ?? ''}
          onChange={(e) => set(k, e.target.value)}
        />
      ) : (
        <input
          className={input}
          disabled={deshabilitado}
          value={spec[k] ?? ''}
          onChange={(e) => set(k, e.target.value)}
        />
      )}
    </div>
  )
  const selec = (k: 'fuente' | 'fondoTexto' | 'colorTexto', nombre: string, opciones: [string, string][]) => (
    <div key={k}>
      <label className={etiqueta}>{nombre}</label>
      <select
        className={input}
        disabled={deshabilitado}
        value={spec[k] ?? ''}
        onChange={(e) => set(k, e.target.value as never)}
      >
        <option value="">Automático</option>
        {opciones.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  )
  return (
    <div className="space-y-2">
      <div>
        <label className={etiqueta}>Plantilla</label>
        <select
          className={input}
          disabled={deshabilitado}
          value={spec.layout}
          onChange={(e) => onCambio(conLayout(spec, e.target.value as HistoriaSpec['layout']))}
        >
          {LAYOUTS.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>
      {campo('titulo', 'Titular', 2)}
      {campo('acento', 'Palabra resaltada')}
      {campo('texto', 'Texto', 3)}
      {spec.layout === 'cifra' && campo('cifra', 'Cifra')}
      {spec.layout === 'comparacion' &&
        (spec.items ?? []).map((it, i) => (
          <div key={i} className="space-y-1 rounded-md border border-border p-2">
            <label className={etiqueta}>Recuadro {i + 1}</label>
            <input
              className={input}
              disabled={deshabilitado}
              value={it.titulo}
              onChange={(e) =>
                set(
                  'items',
                  (spec.items ?? []).map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x))
                )
              }
            />
            <input
              className={input}
              disabled={deshabilitado}
              value={it.texto ?? ''}
              placeholder="Texto"
              onChange={(e) =>
                set(
                  'items',
                  (spec.items ?? []).map((x, j) => (j === i ? { ...x, texto: e.target.value } : x))
                )
              }
            />
          </div>
        ))}
      {spec.layout === 'sticker' && spec.sticker && (
        <div className="space-y-1 rounded-md border border-border p-2">
          <label className={etiqueta}>Sticker</label>
          <input
            className={input}
            disabled={deshabilitado}
            value={spec.sticker.cabecera ?? ''}
            placeholder="Cabecera"
            onChange={(e) => set('sticker', { ...spec.sticker!, cabecera: e.target.value })}
          />
          {spec.sticker.tipo === 'pregunta' && (
            <input
              className={input}
              disabled={deshabilitado}
              value={spec.sticker.texto ?? ''}
              placeholder="Pregunta"
              onChange={(e) => set('sticker', { ...spec.sticker!, texto: e.target.value })}
            />
          )}
        </div>
      )}
      {selec(
        'fuente',
        'Tipografía',
        FUENTES_IG.map((f) => [f, f])
      )}
      {selec('fondoTexto', 'Caja del texto', [
        ['sin', 'Sin caja'],
        ['solido', 'Sólida'],
        ['translucido', 'Translúcida'],
      ])}
      {selec('colorTexto', 'Color de la caja', [
        ['blanco', 'Blanco'],
        ['negro', 'Negro'],
        ['marca', 'Marca'],
      ])}
      <div>
        <label className={etiqueta}>Fondo</label>
        <select
          className={input}
          disabled={deshabilitado}
          value={spec.fondo === 'liso' ? 'liso' : (spec.foto ?? '')}
          onChange={(e) => {
            const v = e.target.value
            onCambio({
              ...spec,
              fondo: v === 'liso' ? 'liso' : undefined,
              foto: v === '' || v === 'liso' ? undefined : Number(v),
            })
          }}
        >
          <option value="">Automático</option>
          <option value="liso">Color liso de la marca</option>
          {medios.map((m, i) => (
            <option key={m.id} value={i + 1}>
              {i + 1}. {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center justify-between text-3xs text-muted-foreground">
        <span>Arrastra «mover texto» sobre la historia o suelta una foto encima.</span>
        {spec.posicion !== undefined && (
          <button className="underline" disabled={deshabilitado} onClick={() => set('posicion', '')}>
            Posición automática
          </button>
        )}
      </div>
      {aviso && <p className="text-3xs text-amber-500">{aviso}</p>}
    </div>
  )
}
