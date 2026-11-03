'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { claveEncargo } from '@/lib/carruseles/historias/encargo'
import { ChatMessage } from './ChatMessage'
import { ChatInput } from './ChatInput'
import { ReferenceImages } from './ReferenceImages'
import { EstiloPanel } from './EstiloPanel'
import { ESTILO_POR_DEFECTO, ESTILOS, esEstilo, type EstiloId } from '@/lib/carruseles/estilos'
import { AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { ReferenceImage } from '@/lib/carruseles/types'
import { useTenant } from '@/lib/tenant-context'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  projectId: string
  referenceImages: ReferenceImage[]
  aspectRatio: string
  numSlides: number
  onStreamStart?: () => void
  onRefresh?: () => void
  onStreamEnd?: () => void
  chatInputRef?: React.Ref<HTMLTextAreaElement>
}

export function ChatPanel({
  projectId,
  referenceImages,
  aspectRatio,
  numSlides,
  onStreamStart,
  onRefresh,
  onStreamEnd,
  chatInputRef,
}: Props) {
  const tenant = useTenant()
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Encargo de historias elegido al crear el proyecto: se ofrece como botón para poder subir fotos antes.
  const [encargo, setEncargo] = useState<string | null>(null)
  // Estilo y uso de las fotos elegidos para este proyecto (se recuerdan en el navegador y viajan con cada mensaje).
  const [estilo, setEstilo] = useState<EstiloId>(ESTILO_POR_DEFECTO)
  const [fotosDeFondo, setFotosDeFondo] = useState(true)
  const esHistorias = aspectRatio === '9:16'

  useEffect(() => {
    try {
      const g = JSON.parse(localStorage.getItem(`carrusel-estilo-${projectId}`) || 'null')
      if (g && esEstilo(g.estilo)) setEstilo(g.estilo)
      if (g && typeof g.fotosDeFondo === 'boolean') setFotosDeFondo(g.fotosDeFondo)
    } catch {
      /* sin preferencia guardada */
    }
  }, [projectId])

  const guardarEstilo = (e: EstiloId, f: boolean) => {
    setEstilo(e)
    setFotosDeFondo(f)
    try {
      localStorage.setItem(`carrusel-estilo-${projectId}`, JSON.stringify({ estilo: e, fotosDeFondo: f }))
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    try {
      const guardado = sessionStorage.getItem(claveEncargo(projectId))
      if (guardado) setEncargo(guardado)
    } catch {
      /* sin sessionStorage no hay encargo precargado */
    }
  }, [projectId])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`carrusel-chat-${projectId}`)
      if (stored) setMessages(JSON.parse(stored))
    } catch {
      /* ignore */
    }
  }, [projectId])

  const persist = useCallback(
    (msgs: Message[]) => {
      try {
        localStorage.setItem(`carrusel-chat-${projectId}`, JSON.stringify(msgs.slice(-40)))
      } catch {
        /* ignore */
      }
    },
    [projectId]
  )

  const clearChat = useCallback(() => {
    setMessages([])
    localStorage.removeItem(`carrusel-chat-${projectId}`)
  }, [projectId])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  const handleSend = useCallback(
    async (message: string): Promise<boolean> => {
      if (isStreaming) return false
      let ok = true
      setError(null)
      setIsStreaming(true)
      onStreamStart?.()

      const history = messages.map((m) => ({ role: m.role, content: m.content }))
      const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: message }
      const assistantId = crypto.randomUUID()
      setMessages((prev) => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '' }])

      abortRef.current = new AbortController()
      let accumulated = ''

      try {
        const res = await fetch(`/api/${tenant}/evergreen/carruseles/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, projectId, history, estilo, fotosDeFondo }),
          signal: abortRef.current.signal,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error((err as { error?: string }).error || 'Error de conexión con la IA')
        }
        const reader = res.body?.getReader()
        if (!reader) throw new Error('Sin stream de respuesta')
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'token' && typeof data.text === 'string') {
                accumulated += data.text
                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: accumulated } : m)))
              } else if (data.type === 'refresh') {
                onRefresh?.()
              } else if (data.type === 'error') {
                setError(data.error || 'Error')
                ok = false
              } else if (data.type === 'warning' && data.warning) {
                toast.warning(data.warning)
              }
            } catch {
              /* skip */
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          // conserva lo generado
        } else {
          setError(err instanceof Error ? err.message : 'Error inesperado')
          ok = false
        }
      } finally {
        setIsStreaming(false)
        abortRef.current = null
        setMessages((prev) => {
          const cleaned = prev.filter((m) => m.role !== 'assistant' || m.id !== assistantId || m.content.length > 0)
          persist(cleaned)
          return cleaned
        })
        onStreamEnd?.()
        onRefresh?.()
      }
      return ok
    },
    [isStreaming, messages, projectId, onStreamStart, onStreamEnd, onRefresh, persist, tenant, estilo, fotosDeFondo]
  )

  const generarEncargo = async () => {
    if (!encargo || isStreaming) return
    const texto = encargo
    setEncargo(null)
    try {
      sessionStorage.removeItem(claveEncargo(projectId))
    } catch {
      /* ignore */
    }
    // Si el envío falla (sin clave de IA, red…) el encargo vuelve a ofrecerse para poder reintentar.
    if (!(await handleSend(texto))) {
      setEncargo(texto)
      try {
        sessionStorage.setItem(claveEncargo(projectId), texto)
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-start justify-between">
        <div>
          <h2 className="text-sm font-semibold">Asistente IA</h2>
          <p className="text-xs text-muted-foreground">Describe el diseño que quieres crear</p>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="text-3xs text-muted-foreground hover:text-destructive transition-colors px-1.5 py-0.5"
          >
            Limpiar
          </button>
        )}
      </div>

      <ReferenceImages projectId={projectId} images={referenceImages} onChange={() => onRefresh?.()} />
      <EstiloPanel
        esHistorias={esHistorias}
        estilo={estilo}
        onEstilo={(e) => guardarEstilo(e, fotosDeFondo)}
        fotosDeFondo={fotosDeFondo}
        onFotosDeFondo={(f) => guardarEstilo(estilo, f)}
        numMedios={referenceImages.length}
        numSlides={numSlides}
        ocupado={isStreaming}
        onAplicar={() =>
          void handleSend(
            `Rehaz TODAS las ${esHistorias ? 'historias' : 'slides'} actuales con el estilo «${ESTILOS[estilo].nombre}», conservando el texto de cada una, con mis fotos y vídeos de fondo y la marca de la subcuenta. ${esHistorias ? 'Usa update_story con el id de cada historia.' : 'Usa update_slide con el id de cada slide.'}`
          )
        }
      />

      {encargo && (
        <div className="mx-4 mt-3 rounded-lg border border-brand-400/40 bg-brand-600/10 p-3">
          <p className="text-xs font-medium text-foreground">Secuencia lista para generar</p>
          <p className="mt-1 whitespace-pre-line text-xs text-muted-foreground">{encargo}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {referenceImages.length > 0
              ? `Usaré tus ${referenceImages.length} foto${referenceImages.length === 1 ? '' : 's'}.`
              : 'Sube antes tus fotos (arriba) para un resultado más real; sin fotos usaré fondos de color.'}
          </p>
          <button
            onClick={() => void generarEncargo()}
            disabled={isStreaming}
            className="mt-2 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-500 disabled:opacity-50"
          >
            Generar secuencia
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="p-6 text-center text-muted-foreground">
            <p className="text-sm mb-1">Sin mensajes todavía</p>
            <p className="text-xs">Dime qué carrusel o flyer quieres crear.</p>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            role={msg.role}
            content={msg.content}
            isStreaming={isStreaming && msg.role === 'assistant' && msg.id === messages[messages.length - 1]?.id}
          />
        ))}
        {error && (
          <div className="mx-4 my-2 flex items-center gap-2 text-destructive text-xs bg-destructive/10 rounded-lg p-3">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}
      </div>

      <ChatInput
        onSend={handleSend}
        isStreaming={isStreaming}
        textareaRef={chatInputRef}
        onStop={() => abortRef.current?.abort()}
      />
    </div>
  )
}
