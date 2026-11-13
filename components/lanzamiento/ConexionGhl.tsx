'use client'

import Link from 'next/link'
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, HelpCircle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/utils'
import type { ConexionResponse } from './tipos'

// CONEXIÓN CON GHL, dentro de Lanzamientos. Antes la dirección del webhook solo estaba en
// Configuración → Integraciones (pantalla de administración) y las variantes por evento no se
// pintaban en ningún sitio: había que componerlas a mano. Aquí salen las cuatro ya montadas, cada
// una con su botón de copiar, junto al estado del secreto y del último evento recibido.

function copiar(texto: string, ok: string) {
  navigator.clipboard
    ?.writeText(texto)
    .then(() => toast.success(ok))
    .catch(() => toast.error('No se pudo copiar: selecciónalo y cópialo a mano'))
}

export function ConexionGhl({
  tenant,
  conexion,
  cargando,
  error,
  onReintentar,
}: {
  tenant: string
  conexion: ConexionResponse | null
  cargando: boolean
  error: string | null
  onReintentar: () => void
}) {
  if (cargando && !conexion) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (error || !conexion) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-300"
      >
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle className="h-4 w-4" /> No se pudo leer la conexión con GHL{error ? `: ${error}` : ''}
        </p>
        <Button variant="outline" size="sm" className="mt-3" onClick={onReintentar}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reintentar
        </Button>
      </div>
    )
  }

  const origen = typeof window === 'undefined' ? '' : window.location.origin
  const integraciones = `/${tenant}/settings/integraciones`

  return (
    <div className="space-y-4">
      {/* ── Estado ─────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Secreto del webhook</p>
          {conexion.secretoConfigurado === true && (
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> Guardado en esta subcuenta
            </p>
          )}
          {conexion.secretoConfigurado === false && (
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" /> Sin configurar: GHL recibirá «Firma inválida»
            </p>
          )}
          {conexion.secretoConfigurado === null && (
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <HelpCircle className="h-4 w-4" /> No se pudo comprobar
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Es una contraseña que eliges tú. Va en dos sitios y tiene que ser idéntica: aquí (Integraciones →
            Lanzamientos) y en cada Custom Webhook de GHL, como cabecera{' '}
            <code className="rounded bg-muted px-1 text-foreground">{conexion.cabecera}</code>.
          </p>
          {conexion.puedeConfigurar ? (
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href={integraciones}>
                {conexion.secretoConfigurado ? 'Ver o cambiar en Integraciones' : 'Generar y guardar el secreto'}
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              El secreto lo guarda quien administra la subcuenta. Pídeselo para pegarlo en GHL.
            </p>
          )}
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Último evento recibido</p>
          {!conexion.eventosLeidos ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <HelpCircle className="h-4 w-4" /> No se pudo comprobar
            </p>
          ) : conexion.ultimoEvento ? (
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" /> {formatDateTime(conexion.ultimoEvento)}
            </p>
          ) : (
            <p className="mt-1 text-sm font-medium text-foreground">Todavía no ha llegado ninguno</p>
          )}
          {conexion.ultimoRechazo && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                GHL llamó el {formatDateTime(conexion.ultimoRechazo)} con un secreto que no coincide. Revisa que la
                cabecera {conexion.cabecera} tenga exactamente el mismo valor, sin espacios.
              </span>
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Para probar: regístrate con tu email en el formulario del evento y pulsa Recargar. Debe aparecer aquí y en
            la pestaña Leads.
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onReintentar} disabled={cargando}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${cargando ? 'animate-spin' : ''}`} /> Recargar
          </Button>
        </div>
      </div>

      {/* ── Direcciones ────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="font-semibold text-foreground">Direcciones para GHL</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          En GHL → Automation → Workflows, añade una acción <strong>Custom Webhook</strong> con método{' '}
          <code className="rounded bg-muted px-1 text-foreground">POST</code> en cada workflow y pega la dirección que
          le corresponde. Solo la de Alta es imprescindible.
        </p>
        <ul className="mt-4 space-y-4">
          {conexion.eventos.map((e) => {
            const url = `${origen}${e.ruta}`
            return (
              <li key={e.id}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium text-foreground">{e.titulo}</span>
                  <span className="text-xs text-muted-foreground">
                    {e.obligatorio ? 'Imprescindible' : 'Opcional'} · {e.cuando}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="flex-1 overflow-x-auto whitespace-nowrap rounded border border-border bg-background/60 px-2 py-1.5 text-xs">
                    {url}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Copiar la dirección de ${e.titulo}`}
                    onClick={() => copiar(url, `Dirección de ${e.titulo} copiada`)}
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>Cabecera que hay que añadir en cada webhook:</span>
          <code className="rounded bg-muted px-1.5 py-0.5 text-foreground">{conexion.cabecera}</code>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => copiar(conexion.cabecera, 'Nombre de la cabecera copiado')}
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar nombre
          </Button>
        </div>
      </div>
    </div>
  )
}
