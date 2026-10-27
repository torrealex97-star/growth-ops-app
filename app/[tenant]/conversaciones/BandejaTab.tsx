'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { MessageSquare, Bot, CheckCircle2, Clock, Inbox, Loader2, Send, Settings2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { useParamUrl } from '@/lib/hooks/useParamUrl'
import { useSesion, useTenantId, useTenant } from '@/lib/tenant-context'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { ESTADOS, ETIQUETA_ESTADO, esEstado, type Estado } from '@/lib/conversaciones/estados'
import { estadoVentana } from '@/lib/conversaciones/ventana'
import { ROLES_IA } from '@/lib/conversaciones/acciones'
import { formatDateTime } from '@/lib/utils'
import { rellenarRespuesta, type RespuestaRapida } from '@/lib/conversaciones/respuestas-rapidas'

type Fila = {
  id: string
  channel: string
  status: string
  ai_mode: string
  labels: string[]
  last_inbound_at: string | null
  last_message_at: string | null
  unread_count: number
  contact_id: string | null
  contacts: { full_name: string | null } | { full_name: string | null }[] | null
}
type Mensaje = { id: string; direction: string; author: string; body: string; sent_at: string }
type Borrador = { id: string; texto: string }

const nombreDe = (c: Fila['contacts']) => (Array.isArray(c) ? c[0] : c)?.full_name ?? 'Sin nombre'
const TODOS = 'todas'
const AUTOR: Record<string, string> = { lead: 'Lead', humano: 'Equipo', ia: 'IA', sistema: 'Sistema' }

export default function BandejaTab() {
  const tenant = useTenant()
  const tenantId = useTenantId()
  const sesion = useSesion()
  const [estado, setEstado] = useParamUrl<string>('estado', 'abierta')
  const [lista, setLista] = useState<Fila[] | null>(null)
  const [errorLista, setErrorLista] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [mensajes, setMensajes] = useState<Mensaje[] | null>(null)
  const [trabajando, setTrabajando] = useState(false)
  const [borradores, setBorradores] = useState<Borrador[]>([])
  const [edicion, setEdicion] = useState<Record<string, string>>({})
  const [respuesta, setRespuesta] = useState('')
  const [rapidas, setRapidas] = useState<RespuestaRapida[]>([])
  const [puedeEditarRapidas, setPuedeEditarRapidas] = useState(false)
  const [tituloNueva, setTituloNueva] = useState('')
  const [etiquetaNueva, setEtiquetaNueva] = useState('')

  const puedeIA = !!sesion && (sesion.isSuperAdmin || (ROLES_IA as readonly string[]).includes(sesion.rol ?? ''))

  useEffect(() => {
    const ctrl = new AbortController()
    fetch(`/api/${tenant}/evergreen/conversaciones/respuestas-rapidas`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!b) return
        setRapidas(Array.isArray(b.respuestas) ? b.respuestas : [])
        setPuedeEditarRapidas(b.puedeEditar === true)
      })
      .catch(() => {})
    return () => ctrl.abort()
  }, [tenant])

  async function guardarRapidas(nuevas: RespuestaRapida[], ok: string) {
    try {
      const res = await fetch(`/api/${tenant}/evergreen/conversaciones/respuestas-rapidas`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ respuestas: nuevas }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'No se pudo guardar')
      setRapidas(body.respuestas ?? nuevas)
      toast.success(ok)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo guardar')
    }
  }

  const cargarLista = useCallback(async () => {
    const sb = createClient()
    let q = sb
      .from('conversations')
      .select(
        'id,channel,status,ai_mode,labels,last_inbound_at,last_message_at,unread_count,contact_id,contacts(full_name)'
      )
      .eq('tenant_id', tenantId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(100)
    if (estado !== TODOS && esEstado(estado)) q = q.eq('status', estado)
    const { data, error } = await q
    if (error) {
      setErrorLista(true)
      return
    }
    setErrorLista(false)
    setLista((data ?? []) as unknown as Fila[])
  }, [tenantId, estado])

  useEffect(() => {
    setLista(null)
    void cargarLista()
  }, [cargarLista])

  useEffect(() => {
    if (!sel) {
      setMensajes(null)
      return
    }
    let vivo = true
    setMensajes(null)
    setBorradores([])
    setRespuesta('')
    ;(async () => {
      const sb = createClient()
      const { data } = await sb
        .from('conversation_messages')
        .select('id,direction,author,body,sent_at')
        .eq('tenant_id', tenantId)
        .eq('conversation_id', sel)
        .order('sent_at', { ascending: true })
        .limit(300)
      const { data: evs } = await sb
        .from('conversation_events')
        .select('id,data')
        .eq('tenant_id', tenantId)
        .eq('conversation_id', sel)
        .eq('kind', 'borrador')
        .order('created_at', { ascending: false })
        .limit(5)
      if (!vivo) return
      setMensajes((data ?? []) as Mensaje[])
      setBorradores(
        ((evs ?? []) as { id: string; data: { texto?: string; estado?: string } }[])
          .filter((e) => e.data?.estado === 'pendiente' && e.data?.texto)
          .map((e) => ({ id: e.id, texto: e.data.texto as string }))
      )
    })()
    return () => {
      vivo = false
    }
  }, [sel, tenantId])

  const actual = useMemo(() => lista?.find((c) => c.id === sel) ?? null, [lista, sel])

  async function accion(cuerpo: Record<string, unknown>, ok: string) {
    if (!sel) return
    setTrabajando(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/conversaciones/${sel}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'No se pudo aplicar')
      toast.success(ok)
      await cargarLista()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo aplicar')
    } finally {
      setTrabajando(false)
    }
  }

  async function recargarHilo() {
    const id = sel
    setSel(null)
    await cargarLista()
    setTimeout(() => setSel(id), 0)
  }

  async function enviarRespuesta() {
    if (!sel || !respuesta.trim()) return
    setTrabajando(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/conversaciones/${sel}/responder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto: respuesta }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'No se pudo enviar')
      toast.success('Mensaje enviado')
      setRespuesta('')
      await recargarHilo()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo enviar')
    } finally {
      setTrabajando(false)
    }
  }

  async function resolverBorrador(b: Borrador, accion: 'aprobar' | 'descartar') {
    if (!sel) return
    setTrabajando(true)
    try {
      const res = await fetch(`/api/${tenant}/evergreen/conversaciones/${sel}/borradores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion, eventoId: b.id, texto: edicion[b.id] ?? b.texto }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'No se pudo completar')
      toast.success(accion === 'aprobar' ? 'Borrador enviado' : 'Borrador descartado')
      await recargarHilo()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo completar')
    } finally {
      setTrabajando(false)
    }
  }

  const ventana = actual ? estadoVentana(actual.channel, 'ia', actual.last_inbound_at) : null

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          Los mensajes de tus leads por Instagram y el resto de canales conectados a GHL, en un solo sitio.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Estado">
        {[TODOS, ...ESTADOS].map((e) => (
          <button
            key={e}
            type="button"
            role="tab"
            aria-selected={estado === e}
            onClick={() => {
              setEstado(e)
              setSel(null)
            }}
            className={`rounded-full border px-3 py-1 text-xs ${estado === e ? 'border-brand-500 bg-brand-500/10 text-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            {e === TODOS ? 'Todas' : ETIQUETA_ESTADO[e as Estado]}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section aria-label="Lista de conversaciones" className="space-y-2">
          {errorLista ? (
            <p
              role="alert"
              className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-400"
            >
              No se pudieron cargar las conversaciones. Recarga la página.
            </p>
          ) : lista === null ? (
            [...Array(5)].map((_, i) => <Skeleton key={i} className="h-16" />)
          ) : lista.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Sin conversaciones"
              description="Cuando un lead escriba y el webhook de mensajes de GHL esté conectado, aparecerá aquí. Lo conectas en Configuración › Integraciones › GoHighLevel."
              className="py-10"
            />
          ) : (
            lista.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSel(c.id)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${sel === c.id ? 'border-brand-500 bg-brand-500/5' : 'border-border bg-card/50 hover:border-brand-500/50'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{nombreDe(c.contacts)}</span>
                  {c.unread_count > 0 ? (
                    <span className="shrink-0 rounded-full bg-brand-500 px-1.5 text-3xs font-semibold text-primary-foreground">
                      {c.unread_count}
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="capitalize">{c.channel}</span>
                  <span>·</span>
                  <span>{ETIQUETA_ESTADO[esEstado(c.status) ? c.status : 'abierta']}</span>
                  {c.ai_mode !== 'off' ? (
                    <span className="inline-flex items-center gap-0.5">
                      <Bot className="h-3 w-3" aria-hidden /> {c.ai_mode}
                    </span>
                  ) : null}
                </div>
              </button>
            ))
          )}
        </section>

        <section aria-label="Conversación" className="min-h-64 rounded-lg border border-border bg-card/40 p-4">
          {!actual ? (
            <EmptyState icon={MessageSquare} title="Elige una conversación" className="py-16" />
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-1.5" aria-label="Etiquetas">
                {actual.labels.map((et) => (
                  <span
                    key={et}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground"
                  >
                    {et}
                    <button
                      type="button"
                      aria-label={`Quitar la etiqueta ${et}`}
                      disabled={trabajando}
                      onClick={() =>
                        accion(
                          { accion: 'etiquetas', etiquetas: actual.labels.filter((x) => x !== et) },
                          'Etiqueta quitada'
                        )
                      }
                      className="text-muted-foreground hover:text-foreground"
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input
                  value={etiquetaNueva}
                  onChange={(e) => setEtiquetaNueva(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' || !etiquetaNueva.trim()) return
                    e.preventDefault()
                    const nueva = etiquetaNueva.trim().toLowerCase()
                    setEtiquetaNueva('')
                    if (!actual.labels.includes(nueva))
                      accion({ accion: 'etiquetas', etiquetas: [...actual.labels, nueva] }, 'Etiqueta añadida')
                  }}
                  maxLength={30}
                  placeholder="+ etiqueta"
                  aria-label="Añadir etiqueta"
                  className="w-28 rounded-full border border-dashed border-border bg-transparent px-2 py-0.5 text-xs text-foreground placeholder:text-muted-foreground"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">{nombreDe(actual.contacts)}</h2>
                  <p className="text-xs text-muted-foreground">
                    {actual.channel} · último mensaje {formatDateTime(actual.last_message_at)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {actual.status === 'resuelta' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={trabajando}
                      onClick={() => accion({ accion: 'reabrir' }, 'Conversación reabierta')}
                    >
                      <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Reabrir
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={trabajando}
                        onClick={() => accion({ accion: 'resolver' }, 'Conversación resuelta')}
                      >
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> Resolver
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={trabajando}
                        onClick={() =>
                          accion(
                            { accion: 'aplazar', hasta: new Date(Date.now() + 24 * 3_600_000).toISOString() },
                            'Aplazada 24 h'
                          )
                        }
                      >
                        <Clock className="mr-1.5 h-3.5 w-3.5" /> Aplazar 24 h
                      </Button>
                    </>
                  )}
                  {actual.ai_mode !== 'off' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={trabajando}
                      onClick={() => accion({ accion: 'traspasar' }, 'Pasa a una persona')}
                    >
                      Pasar a una persona
                    </Button>
                  ) : null}
                </div>
              </div>

              {ventana ? (
                <p className={`text-xs ${ventana.abierta ? 'text-emerald-400' : 'text-amber-400'}`}>
                  Ventana de la IA: {ventana.motivo}
                  {ventana.expiraEn && ventana.abierta ? ` · hasta ${formatDateTime(ventana.expiraEn)}` : ''}
                </p>
              ) : null}

              {puedeIA ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Agente de IA en esta conversación
                  <select
                    value={actual.ai_mode}
                    disabled={trabajando}
                    onChange={(e) => accion({ accion: 'modo_ia', modo: e.target.value }, 'Modo de la IA actualizado')}
                    className="rounded border border-border bg-card px-2 py-1 text-xs text-foreground"
                  >
                    <option value="off">Apagado</option>
                    <option value="borrador">Borrador (aprueba una persona)</option>
                    <option value="autonomo">Autónomo (solo dentro de la ventana)</option>
                  </select>
                </label>
              ) : null}

              <div className="max-h-[50vh] space-y-2 overflow-y-auto rounded-lg border border-border/60 bg-background/40 p-3">
                {mensajes === null ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Cargando" />
                ) : mensajes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aún no hay mensajes guardados.</p>
                ) : (
                  mensajes.map((m) => (
                    <div key={m.id} className={`flex ${m.direction === 'saliente' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.direction === 'saliente' ? 'bg-brand-500/15 text-foreground' : 'bg-muted text-foreground'}`}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p className="mt-1 text-3xs text-muted-foreground">
                          {AUTOR[m.author] ?? m.author} · {formatDateTime(m.sent_at)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {borradores.map((b) => (
                <div key={b.id} className="space-y-2 rounded-lg border border-brand-500/40 bg-brand-500/5 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                    <Bot className="h-3.5 w-3.5" aria-hidden /> Borrador del agente: revísalo antes de enviarlo
                  </p>
                  <textarea
                    value={edicion[b.id] ?? b.texto}
                    onChange={(e) => setEdicion((p) => ({ ...p, [b.id]: e.target.value }))}
                    rows={3}
                    maxLength={1000}
                    aria-label="Texto del borrador"
                    className="w-full rounded-lg border border-border bg-muted p-2 text-sm text-foreground"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={trabajando || !ventana?.abierta}
                      onClick={() => resolverBorrador(b, 'aprobar')}
                    >
                      <Send className="mr-1.5 h-3.5 w-3.5" /> Aprobar y enviar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={trabajando}
                      onClick={() => resolverBorrador(b, 'descartar')}
                    >
                      Descartar
                    </Button>
                  </div>
                </div>
              ))}

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {rapidas.length ? (
                    <select
                      aria-label="Respuestas rápidas"
                      value=""
                      disabled={!ventana?.abierta}
                      onChange={(e) => {
                        const r = rapidas.find((x) => x.id === e.target.value)
                        if (r) setRespuesta(rellenarRespuesta(r.texto, nombreDe(actual.contacts)))
                      }}
                      className="rounded-lg border border-border bg-muted p-1.5 text-xs text-foreground"
                    >
                      <option value="">Respuesta rápida…</option>
                      {rapidas.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.titulo}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {puedeEditarRapidas && rapidas.length ? (
                    <select
                      aria-label="Quitar una respuesta rápida"
                      value=""
                      onChange={(e) => {
                        const id = e.target.value
                        // Confirmación: con teclado, mover la flecha por un <select> cerrado dispara `change` y borraría la
                        // primera respuesta rápida del equipo sin querer.
                        if (
                          id &&
                          window.confirm(
                            '¿Quitar esta respuesta rápida? Dejará de estar disponible para todo el equipo.'
                          )
                        )
                          guardarRapidas(
                            rapidas.filter((x) => x.id !== id),
                            'Respuesta rápida quitada'
                          )
                      }}
                      className="rounded-lg border border-border bg-muted p-1.5 text-xs text-muted-foreground"
                    >
                      <option value="">Quitar…</option>
                      {rapidas.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.titulo}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {puedeEditarRapidas && respuesta.trim() ? (
                    <span className="flex items-center gap-1">
                      <input
                        value={tituloNueva}
                        onChange={(e) => setTituloNueva(e.target.value)}
                        maxLength={40}
                        placeholder="Título para guardar este texto"
                        aria-label="Título de la respuesta rápida"
                        className="w-48 rounded-lg border border-border bg-muted p-1.5 text-xs text-foreground"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!tituloNueva.trim()}
                        onClick={async () => {
                          await guardarRapidas(
                            [...rapidas, { id: '', titulo: tituloNueva.trim(), texto: respuesta.trim() }],
                            'Respuesta rápida guardada'
                          )
                          setTituloNueva('')
                        }}
                      >
                        Guardar
                      </Button>
                    </span>
                  ) : null}
                </div>
                <textarea
                  value={respuesta}
                  onChange={(e) => setRespuesta(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  placeholder={
                    ventana?.abierta
                      ? 'Escribe tu respuesta…'
                      : 'La ventana de respuesta está cerrada: responde desde GHL.'
                  }
                  disabled={!ventana?.abierta}
                  aria-label="Tu respuesta"
                  className="w-full rounded-lg border border-border bg-muted p-2 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-60"
                />
                <Button
                  size="sm"
                  disabled={trabajando || !respuesta.trim() || !ventana?.abierta}
                  onClick={enviarRespuesta}
                >
                  <Send className="mr-1.5 h-3.5 w-3.5" /> Enviar
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
