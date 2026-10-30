'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Pin, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  indiceEnReplay,
  lineaReplay,
  offsetDePaso,
  programaReplay,
  type EventoReplay,
  type MensajeReplay,
  type NotaReplay,
  type PasoReplay,
} from '@/lib/conversaciones/replay'
import { formatDateTime } from '@/lib/utils'

// REPRODUCTOR de replay temporal del hilo (patrón OpenReplay, en la app): qué pasó, paso a paso, sobre el
// RELOJ REAL de la conversación (los pasos van al instante en el que ocurrieron, no a un ritmo inventado).
// Reproducir/pausa corre el reloj desde el primer paso; velocidad (1×/5×/20×), salto anterior/siguiente y
// barra de posición. Salir devuelve el hilo normal; releer sin recargar la conversación con «reiniciar».
const VELOCIDADES = [1, 5, 20] as const
const TICK_MS = 100

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h > 0 ? `${h}:` : ''}${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const AUTOR: Record<string, string> = { lead: 'Lead', humano: 'Equipo', ia: 'IA', sistema: 'Sistema' }

export default function HiloReplay({
  mensajes,
  eventos,
  notas,
  onSalir,
}: {
  mensajes: MensajeReplay[]
  eventos: EventoReplay[]
  notas: NotaReplay[]
  onSalir: () => void
}) {
  // La línea de pasos es puro: se recalcula solo si cambian los datos; el reloj es un offset (ms) sobre
  // el primer paso, NO sobre «ahora».
  const programa = useMemo(() => programaReplay(lineaReplay(mensajes, eventos, notas)), [mensajes, eventos, notas])
  const pasos = programa.pasos
  const total = programa.duracionMs

  const [offset, setOffset] = useState(0)
  const [corriendo, setCorriendo] = useState(false)
  const [velocidad, setVelocidad] = useState<number>(VELOCIDADES[0])

  const pasoActual = indiceEnReplay(pasos, offset)
  const alFinal = total <= 0 || offset >= total

  // Reloj: tick de 100 ms × velocidad; al llegar al final se detiene: continuar el replay es volver a pulsar.
  useEffect(() => {
    if (!corriendo || pasos.length === 0) return
    const ref = window.setInterval(() => {
      setOffset((o) => {
        const next = o + TICK_MS * velocidad
        if (next >= total) {
          setCorriendo(false)
          return total
        }
        return next
      })
    }, TICK_MS)
    return () => window.clearInterval(ref)
  }, [corriendo, velocidad, total, pasos.length])

  const irAPaso = useCallback(
    (i: number) => {
      if (pasos.length === 0) return
      const destino = Math.max(0, Math.min(i, pasos.length - 1))
      setOffset(offsetDePaso(pasos, destino))
      setCorriendo(false)
    },
    [pasos]
  )

  const reiniciar = () => {
    setOffset(0)
    setCorriendo(false)
  }

  const reproducir = () => {
    if (alFinal) reiniciar()
    setCorriendo((c) => !c)
  }

  const visibles = pasos.slice(0, Math.max(0, pasoActual + 1))
  const refLista = useRef<HTMLDivElement>(null)
  useEffect(() => {
    refLista.current?.scrollTo({ top: refLista.current.scrollHeight })
  }, [pasoActual])

  return (
    <div className="space-y-2 rounded-lg border border-brand-500/30 bg-background/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Controles del replay">
        <Button
          size="sm"
          variant="outline"
          disabled={pasos.length === 0}
          onClick={reproducir}
          aria-label={corriendo ? 'Pausar replay' : 'Reproducir replay'}
        >
          {corriendo ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {corriendo ? 'Pausar' : alFinal ? 'Volver a reproducir' : 'Reproducir'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pasoActual <= 0}
          onClick={() => irAPaso(pasoActual - 1)}
          aria-label="Paso anterior"
        >
          <SkipBack className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pasoActual >= pasos.length - 1}
          onClick={() => irAPaso(pasoActual + 1)}
          aria-label="Paso siguiente"
        >
          <SkipForward className="h-3.5 w-3.5" />
        </Button>
        <select
          aria-label="Velocidad del replay"
          value={velocidad}
          onChange={(e) => setVelocidad(Number(e.target.value) || VELOCIDADES[0])}
          className="rounded border border-border bg-card px-1.5 py-1 text-xs text-foreground"
        >
          {VELOCIDADES.map((v) => (
            <option key={v} value={v}>
              {v}×
            </option>
          ))}
        </select>
        <span className="ml-auto text-3xs text-muted-foreground">
          {pasos.length
            ? `${pasoActual + 1} / ${pasos.length} · ${mmss(offset)} / ${mmss(total)}`
            : 'Sin historia que reproducir'}
        </span>
        <Button size="sm" variant="ghost" onClick={reiniciar} disabled={offset === 0 && !corriendo}>
          Reiniciar
        </Button>
        <Button size="sm" variant="ghost" onClick={onSalir} aria-label="Salir del replay">
          <X className="mr-0.5 h-3.5 w-3.5" /> Salir
        </Button>
      </div>

      <input
        type="range"
        min={0}
        max={Math.max(1, total)}
        value={offset}
        step={TICK_MS}
        disabled={pasos.length === 0}
        onChange={(e) => setOffset(Math.min(Number(e.target.value) || 0, total))}
        aria-label="Posición del replay"
        className="w-full accent-brand-500"
      />

      <div
        ref={refLista}
        aria-label="Replay del hilo"
        className="max-h-[50vh] space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-card/30 p-3"
      >
        {visibles.length === 0 ? (
          <p className="text-sm text-muted-foreground">Reproduce o avanza para ver la historia del hilo.</p>
        ) : (
          visibles.map((paso, i) => (
            <PasoVista
              // La clave mezcla instante y posición: dos pasos con el mismo `t` siguen siendo únicos.
              key={`${paso.t}-${i}`}
              paso={paso}
              inicio={programa.inicio}
              actual={i === pasoActual}
              onPulso={() => irAPaso(i)}
            />
          ))
        )}
      </div>
    </div>
  )
}

function PasoVista({
  paso,
  inicio,
  actual,
  onPulso,
}: {
  paso: PasoReplay
  inicio: string | null
  actual: boolean
  onPulso: () => void
}) {
  const relativo = inicio ? Date.parse(paso.t) - Date.parse(inicio) : 0
  const saliente = paso.tipo === 'mensaje' && paso.direction === 'saliente'
  return (
    <button
      type="button"
      onClick={onPulso}
      aria-current={actual ? 'step' : undefined}
      className={`flex w-full text-left ${saliente ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${saliente ? 'bg-brand-500/15' : 'bg-muted'} ${
          actual ? 'ring-1 ring-brand-500/60 text-foreground' : 'text-foreground/70'
        }`}
      >
        {paso.tipo === 'mensaje' ? (
          <p className="whitespace-pre-wrap break-words">{paso.body}</p>
        ) : paso.tipo === 'nota' ? (
          <p className="flex items-start gap-1.5 whitespace-pre-wrap break-words italic">
            <Pin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> Nota privada: {paso.texto}
          </p>
        ) : (
          <p className="text-xs font-medium">{paso.texto}</p>
        )}
        <p className="mt-1 text-3xs text-muted-foreground">
          {paso.tipo === 'mensaje' ? `${AUTOR[paso.author ?? ''] ?? paso.author} · ` : ''}
          {mmss(Math.max(0, relativo))} · {formatDateTime(paso.t)}
        </p>
      </div>
    </button>
  )
}
