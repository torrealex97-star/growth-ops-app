'use client'

/**
 * Conexiones IA (MCP): clientes de ChatGPT/Claude autorizados por ESTE usuario y sus sesiones
 * activas, con revocación. El estado (activa/revocada/caducada) lo calcula el servidor — aquí
 * solo se pinta. Un access token caducado con refresh vivo sigue siendo una sesión activa:
 * el cliente puede renovarla solo.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Bot,
  Check,
  CheckCircle2,
  ClipboardCopy,
  ExternalLink,
  KeyRound,
  Loader2,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Server,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EstadoPanel } from '@/components/ui/carga/EstadoPanel'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { pedir, esFalloVisible, type Fallo } from '@/lib/ui/pedir'

type ClienteConnectado = {
  client_id: string
  name: string
  owner_user_id: string | null
  redirect_uris: string[]
  created_at: string
}

type SesionMcp = {
  id: string
  client_id: string
  client_name: string | null
  scope: string
  created_at: string
  expires_at: string
  revoked_at: string | null
  refresh_expires_at: string | null
  estado: 'activa' | 'revocada' | 'caducada'
}

type EstadoServidorMcp = {
  endpoint: string
  ready: boolean
  authentication: 'OAuth 2.1 + PKCE'
  manualTokenRequired: false
}

const CORTES: Record<SesionMcp['estado'], { etiqueta: string; clase: string }> = {
  activa: { etiqueta: 'Activa', clase: 'bg-emerald-500/10 text-emerald-500' },
  revocada: { etiqueta: 'Revocada', clase: 'bg-red-500/10 text-red-500' },
  caducada: { etiqueta: 'Caducada', clase: 'bg-zinc-500/10 text-muted-foreground' },
}

function corto(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const PASOS_CHATGPT = [
  'En ChatGPT abre Configuración → Aplicaciones → Configuración avanzada y activa el modo desarrollador.',
  'Vuelve a Aplicaciones, pulsa Crear y ponle el nombre “GrowthOps”.',
  'Pega la URL del servidor, elige OAuth y pulsa Analizar herramientas.',
  'Inicia sesión aquí, revisa el permiso de solo lectura y pulsa Autorizar. Después termina con Crear.',
]

const PASOS_CLAUDE = [
  'En Claude abre Configuración → Conectores → Añadir conector personalizado.',
  'Escribe “GrowthOps” como nombre y pega la URL del servidor.',
  'Pulsa Añadir y después Conectar. Claude abrirá aquí la autorización OAuth.',
  'Autoriza el acceso y activa GrowthOps desde Búsqueda y herramientas cuando quieras usarlo.',
]

function PasosConexion({ pasos }: { pasos: string[] }) {
  return (
    <ol className="space-y-3">
      {pasos.map((paso, index) => (
        <li key={paso} className="flex gap-3 text-sm">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/10 text-xs font-semibold text-brand-400">
            {index + 1}
          </span>
          <span className="pt-0.5 text-muted-foreground">{paso}</span>
        </li>
      ))}
    </ol>
  )
}

export function McpConexionesPanel() {
  const [clientes, setClientes] = useState<ClienteConnectado[] | null>(null)
  const [sesiones, setSesiones] = useState<SesionMcp[] | null>(null)
  const [servidor, setServidor] = useState<EstadoServidorMcp | null>(null)
  const [falloCarga, setFalloCarga] = useState<Fallo | null>(null)
  const [cargandoRevocar, setCargandoRevocar] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<'endpoint' | 'prompt' | null>(null)

  // fetch/pedir: mismo patrón de la casa — timeout y captura del fallo, sin bloques eternos.
  const load = useCallback(async () => {
    const res = await pedir<{
      clientes: ClienteConnectado[]
      sesiones: SesionMcp[]
      servidor: EstadoServidorMcp
    }>('/api/mcp/management')
    if (!res.ok) {
      if (!esFalloVisible(res)) return
      setFalloCarga(res)
      toast.error(res.mensaje)
      return
    }
    setClientes(res.data.clientes)
    setSesiones(res.data.sesiones)
    setServidor(res.data.servidor)
    setFalloCarga(null)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function revocarSesion(b: SesionMcp) {
    if (!window.confirm(`¿Revocar la sesión de «${b.client_name ?? b.client_id}»? El cliente tendrá que reconectar.`))
      return
    setCargandoRevocar(b.id)
    try {
      const r = await fetch('/api/mcp/management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revocar_sesion', tokenId: b.id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(j.error || 'No se pudo revocar la sesión')
        return
      }
      toast.success('Sesión revocada: el acceso del cliente queda inmediatamente invalidado')
      await load()
    } finally {
      setCargandoRevocar(null)
    }
  }

  async function revocarCliente(cliente: ClienteConnectado) {
    const n = (sesiones ?? []).filter((x) => x.client_id === cliente.client_id && x.estado === 'activa').length
    if (
      !window.confirm(
        `¿Revocar por completo "${cliente.name}"? Se cerrarán ${n} sesión${n === 1 ? '' : 'es'} activa(s) y el cliente desaparecerá de esta lista (tendrá que autorizarse de nuevo).`
      )
    )
      return
    setCargandoRevocar(cliente.client_id)
    try {
      const r = await fetch('/api/mcp/management', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'revocar_cliente', clientId: cliente.client_id }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(j.error || 'No se pudo revocar el acceso')
        return
      }
      toast.success(`Acceso de «${cliente.name}» revocado por completo`)
      await load()
    } finally {
      setCargandoRevocar(null)
    }
  }

  async function copiar(texto: string, tipo: 'endpoint' | 'prompt') {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(tipo)
      toast.success(tipo === 'endpoint' ? 'URL MCP copiada' : 'Prompt de prueba copiado')
      window.setTimeout(() => setCopiado((actual) => (actual === tipo ? null : actual)), 2000)
    } catch {
      toast.error('No se pudo copiar. Selecciona el texto y cópialo manualmente.')
    }
  }

  if (falloCarga) {
    return (
      <EstadoPanel
        estado={falloCarga.tipo === 'permiso' ? 'sin_permiso' : 'error'}
        que="las conexiones IA"
        mensajeError={falloCarga.mensaje}
        onReintentar={falloCarga.reintentable ? () => void load() : undefined}
      />
    )
  }

  if (clientes === null || sesiones === null || servidor === null) {
    return <EstadoPanel estado="cargando" que="las conexiones IA" filasSkeleton={2} />
  }

  const numActivas = sesiones.filter((s) => s.estado === 'activa').length

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-500/10">
            <Bot className="h-5 w-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Conexiones IA (MCP)</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Conecta ChatGPT, Claude u otro cliente compatible para consultar tus datos con acceso de solo lectura.
            </p>
          </div>
        </div>
        <Badge variant={servidor.ready ? 'success' : 'destructive'} className="gap-1.5 py-1">
          {servidor.ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <TriangleAlert className="h-3.5 w-3.5" />}
          {servidor.ready ? 'Servidor listo' : 'Servidor sin configurar'}
        </Badge>
      </header>

      <section className="overflow-hidden rounded-xl border border-border bg-card" aria-labelledby="conectar-mcp-title">
        <div className="border-b border-border/70 p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10">
              <Server className="h-4 w-4 text-brand-400" />
            </div>
            <div>
              <h2 id="conectar-mcp-title" className="text-lg font-semibold text-foreground">
                Conecta tu asistente
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">Esta es la única URL que tendrás que copiar.</p>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground">
              {servidor.endpoint}
            </code>
            <Button onClick={() => void copiar(servidor.endpoint, 'endpoint')} className="shrink-0">
              {copiado === 'endpoint' ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
              {copiado === 'endpoint' ? 'Copiada' : 'Copiar URL'}
            </Button>
          </div>

          <div className="mt-4 flex gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <p className="text-sm text-muted-foreground">
              <strong className="font-medium text-foreground">No necesitas crear ni pegar tokens.</strong> El cliente
              registra la conexión y recibe sus tokens automáticamente mediante OAuth 2.1. Nunca compartas contraseñas
              ni claves de Supabase.
            </p>
          </div>

          {!servidor.ready && (
            <div className="mt-4 flex gap-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <p className="text-sm text-red-300">
                Falta la configuración segura del servidor. No intentes conectar todavía; un administrador debe revisar
                MCP_JWT_SECRET en Vercel.
              </p>
            </div>
          )}
        </div>

        <div className="p-5 sm:p-6">
          <Tabs defaultValue="chatgpt">
            <TabsList className="grid h-auto w-full grid-cols-3 sm:w-fit">
              <TabsTrigger value="chatgpt">ChatGPT</TabsTrigger>
              <TabsTrigger value="claude">Claude</TabsTrigger>
              <TabsTrigger value="otros">Otros</TabsTrigger>
            </TabsList>
            <TabsContent value="chatgpt" className="mt-5">
              <PasosConexion pasos={PASOS_CHATGPT} />
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
                <Button asChild variant="outline" size="sm">
                  <a href="https://chatgpt.com" target="_blank" rel="noreferrer">
                    Abrir ChatGPT <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
                <a
                  href="https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Requisitos de plan y permisos
                </a>
              </div>
            </TabsContent>
            <TabsContent value="claude" className="mt-5">
              <PasosConexion pasos={PASOS_CLAUDE} />
              <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
                <Button asChild variant="outline" size="sm">
                  <a href="https://claude.ai" target="_blank" rel="noreferrer">
                    Abrir Claude <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
                <a
                  href="https://support.anthropic.com/en/articles/11175166-about-custom-integrations-using-remote-mcp"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Ayuda oficial de conectores
                </a>
              </div>
            </TabsContent>
            <TabsContent value="otros" className="mt-5">
              <div className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                  <p className="font-medium text-foreground">Transporte</p>
                  <p className="mt-1 text-muted-foreground">Streamable HTTP · protocolo MCP 2025-06-18</p>
                </div>
                <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                  <p className="font-medium text-foreground">Autenticación</p>
                  <p className="mt-1 text-muted-foreground">OAuth 2.1 · registro dinámico · PKCE S256</p>
                </div>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                En cualquier cliente compatible, añade un servidor MCP remoto, pega la misma URL y selecciona OAuth. No
                configures un Bearer token manual.
              </p>
            </TabsContent>
          </Tabs>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]" aria-label="Seguridad y comprobación MCP">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-4 w-4 text-emerald-400" />
            <h2 className="font-semibold text-foreground">Qué podrá consultar</h2>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              Solo las subcuentas que tu usuario ya puede ver.
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              Contactos, agendas, ventas, cobros, campañas y métricas en modo lectura.
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
              No puede crear, modificar ni borrar datos.
            </li>
          </ul>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold text-foreground">Prueba la conexión</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Cuando aparezca como conectada, actívala en tu chat y envía este mensaje:
          </p>
          <div className="mt-3 rounded-lg border border-border bg-background p-3 text-sm text-foreground">
            Lista las subcuentas a las que tengo acceso.
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => void copiar('Lista las subcuentas a las que tengo acceso.', 'prompt')}
          >
            {copiado === 'prompt' ? <Check className="h-4 w-4" /> : <ClipboardCopy className="h-4 w-4" />}
            {copiado === 'prompt' ? 'Copiado' : 'Copiar prueba'}
          </Button>
        </div>
      </section>

      <section aria-labelledby="conexiones-autorizadas-title" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="conexiones-autorizadas-title" className="font-semibold text-foreground">
              Conexiones autorizadas
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Aquí podrás comprobar y revocar cada asistente después de autorizarlo.
              {sesiones.length > 0 && ` ${numActivas} sesión${numActivas === 1 ? ' activa' : 'es activas'}.`}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" aria-hidden />
            Actualizar
          </Button>
        </div>

        {clientes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center">
            <ShieldCheck className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium text-foreground">Todavía no hay asistentes autorizados</p>
            <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">
              Completa los pasos anteriores. Después de aprobar OAuth, la conexión y sus sesiones aparecerán aquí.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {clientes.map((cliente) => {
              const sesionesCliente = sesiones.filter((s) => s.client_id === cliente.client_id)
              const activas = sesionesCliente.filter((s) => s.estado === 'activa')
              return (
                <div key={cliente.client_id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-emerald-500" aria-hidden />
                        <p className="font-medium text-foreground">{cliente.name}</p>
                        <span className="text-muted-foreground text-xs">desde {corto(cliente.created_at)}</span>
                      </div>
                      <p className="text-muted-foreground mt-1 truncate text-xs">
                        {sesionesCliente.filter((s) => s.estado === 'activa').length} de {sesionesCliente.length}{' '}
                        sesión(es) activas
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={cargandoRevocar === cliente.client_id}
                      onClick={() => void revocarCliente(cliente)}
                    >
                      {cargandoRevocar === cliente.client_id ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="h-4 w-4" aria-hidden />
                      )}
                      Revocar acceso completo
                    </Button>
                  </div>

                  {sesionesCliente.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {sesionesCliente.map((s) => {
                        const meta = CORTES[s.estado]
                        return (
                          <div
                            key={s.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 bg-muted/30 px-3 py-2"
                          >
                            <div className="min-w-0">
                              <p className="text-sm">
                                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${meta.clase}`}>
                                  {meta.etiqueta}
                                </span>{' '}
                                <span className="text-muted-foreground">
                                  creada {corto(s.created_at)} · expira {corto(s.expires_at)}
                                </span>
                              </p>
                            </div>
                            {s.estado === 'activa' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={cargandoRevocar === s.id}
                                onClick={() => void revocarSesion(s)}
                              >
                                {cargandoRevocar === s.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                ) : (
                                  <LogOut className="h-4 w-4" aria-hidden />
                                )}
                                Revocar sesión
                              </Button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
