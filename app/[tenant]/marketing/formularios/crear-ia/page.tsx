'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, Send, Sparkles } from 'lucide-react'
import { useTenant } from '@/lib/tenant-context'
import { PropuestaFormulario, type Propuesta } from '@/components/forms/PropuestaFormulario'

// CREAR UN FORMULARIO HABLANDO CON LA IA. Describes lo que quieres; si le falta algo, pregunta; cuando lo
// tiene, propone el formulario, y puedes seguir pidiéndole cambios hasta crearlo. Ver lib/forms/ai-builder.ts.

type Turno = { role: 'user' | 'assistant'; content: string }

const EJEMPLOS = [
  'Un formulario para filtrar a quien pide una llamada de ventas: situación, objetivo, facturación y si puede invertir. Que puntúe y separe los leads calientes.',
  'Formulario de candidatura para setters: experiencia, disponibilidad horaria y nivel de inglés.',
  'Encuesta de satisfacción al terminar un módulo, con valoración en estrellas y qué mejorarían.',
]

export default function CrearConIaPage() {
  const tenant = useTenant()
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [propuesta, setPropuesta] = useState<Propuesta | null>(null)
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  const [error, setError] = useState('')
  const finRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Al salir de la pantalla se cancela la petición en curso (puede tardar medio minuto).
  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [turnos, pensando])

  // `base` = historial sobre el que se añade el mensaje (al reintentar, el historial sin el turno fallido).
  const enviar = async (mensaje: string, base: Turno[] = turnos) => {
    const contenido = mensaje.trim()
    if (!contenido || pensando) return
    const historial: Turno[] = [...base, { role: 'user', content: contenido }]
    setTurnos(historial)
    setTexto('')
    setError('')
    setPensando(true)
    const ctl = new AbortController()
    abortRef.current = ctl
    try {
      const r = await fetch(`/api/${tenant}/evergreen/forms/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctl.signal,
        body: JSON.stringify({
          messages: historial,
          current: propuesta
            ? {
                name: propuesta.name,
                category: propuesta.category,
                audience: propuesta.audience,
                config: propuesta.config,
              }
            : null,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'La IA no ha respondido')
      if (j.type === 'form') {
        setPropuesta({ name: j.name, category: j.category, audience: j.audience, config: j.config, avisos: j.avisos })
        setTurnos([...historial, { role: 'assistant', content: j.message || 'Aquí tienes el formulario.' }])
      } else {
        const preguntas: string[] = Array.isArray(j.questions) ? j.questions : []
        const cuerpo = [j.message, ...preguntas.map((p, i) => (preguntas.length > 1 ? `${i + 1}. ${p}` : p))]
          .filter(Boolean)
          .join('\n')
        setTurnos([...historial, { role: 'assistant', content: cuerpo }])
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      // El mensaje de la persona se queda en el historial: puede reintentar sin reescribirlo.
      setError((e as Error).message)
    } finally {
      setPensando(false)
    }
  }

  const reintentar = () => {
    const ultimo = turnos[turnos.length - 1]
    if (ultimo?.role === 'user') void enviar(ultimo.content, turnos.slice(0, -1))
  }

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <div className="space-y-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Sparkles className="h-5 w-5 text-brand-400" /> Crear con IA
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Describe el formulario que necesitas. Si falta algo te lo pregunta, y cuando lo tiene te lo propone con sus
            preguntas. También puedes pegar las preguntas de un formulario que ya tengas en otra herramienta.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card">
          <div className="max-h-[55vh] min-h-[220px] space-y-3 overflow-y-auto p-4" aria-live="polite">
            {turnos.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Por ejemplo</p>
                {EJEMPLOS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setTexto(e)}
                    className="block w-full rounded-lg border border-border px-3 py-2 text-left text-sm text-muted-foreground hover:border-brand-500 hover:text-foreground"
                  >
                    {e}
                  </button>
                ))}
              </div>
            )}
            {turnos.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <p
                  className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm ${
                    t.role === 'user' ? 'bg-brand-600 text-white' : 'bg-muted text-foreground'
                  }`}
                >
                  {t.content}
                </p>
              </div>
            ))}
            {pensando && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {propuesta ? 'Aplicando el cambio…' : 'Pensando…'}
              </p>
            )}
            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
                {error}{' '}
                <button type="button" onClick={reintentar} className="underline hover:text-red-300">
                  Reintentar
                </button>
              </div>
            )}
            <div ref={finRef} />
          </div>
          <form
            className="flex items-end gap-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault()
              void enviar(texto)
            }}
          >
            <label htmlFor="creador-mensaje" className="sr-only">
              Mensaje
            </label>
            <textarea
              id="creador-mensaje"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void enviar(texto)
                }
              }}
              rows={3}
              maxLength={6000}
              placeholder={
                propuesta
                  ? 'Pide un cambio: «quita el teléfono», «añade una pregunta de presupuesto»…'
                  : turnos.length
                    ? 'Responde aquí…'
                    : 'Quiero un formulario para…'
              }
              className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-brand-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={pensando || !texto.trim()}
              aria-label="Enviar"
              className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-brand-600 text-white hover:bg-brand-500 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
        <p className="text-xs text-muted-foreground">
          ¿Ya lo tienes en Typeform, Calendly o GoHighLevel?{' '}
          <Link href={`/${tenant}/marketing/formularios/importar`} className="text-brand-400 hover:text-brand-300">
            Impórtalo
          </Link>
          .
        </p>
      </div>

      <div>
        {propuesta ? (
          <PropuestaFormulario
            propuesta={propuesta}
            onNombre={(name) => setPropuesta({ ...propuesta, name })}
            pie="Si quieres cambiar algo, pídeselo en el chat o créalo y edítalo en el constructor."
          />
        ) : (
          <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            Aquí verás el formulario propuesto, con sus preguntas, antes de crearlo.
          </div>
        )}
      </div>
    </div>
  )
}
