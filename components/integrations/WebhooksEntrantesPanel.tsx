'use client'

import { Button } from '@/components/ui/button'
import { Radio, Copy, CheckCircle2, XCircle, KeyRound, ShieldAlert, ExternalLink, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { WebhookEntranteEstado, EstadoSecretInfo } from '@/lib/webhooks/entrantes'
import { formatDateTime } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────────────────────
// BLOQUE «WEBHOOKS ENTRANTES» — la mitad receptora de las integraciones
// ─────────────────────────────────────────────────────────────────────────────
// Hasta ahora, dar de alta un webhook exigía buscar la URL en una guía, adivinar
// si el secret estaba bien y descubrir a posteriori que nada entraba. Aquí está
// todo junto: la URL exacta de esta subcuenta con botón de copiar, el estado
// REAL del secreto (con la pista de dónde vive el valor que se usa) y la fecha
// del último evento recibido CON SU EVIDENCIA — nunca derivada de las filas del
// negocio, que el pull del cron también escribe.
//
// «—» significa "nunca ha llegado ninguno". No es 0 ni un error: es la verdad
// que permitió demostrar forensemente que el webhook de GHL nunca entró.

const SECRET_META: Record<EstadoSecretInfo['estado'], { etiqueta: string; clase: string; icono: typeof KeyRound }> = {
  ok: { etiqueta: 'Configurado', clase: 'text-emerald-400', icono: CheckCircle2 },
  solo_entorno: { etiqueta: 'Solo en entorno', clase: 'text-amber-400', icono: KeyRound },
  sin_configurar: { etiqueta: 'Sin configurar', clase: 'text-red-400', icono: XCircle },
  no_descifrable: { etiqueta: 'No descifrable', clase: 'text-red-400', icono: ShieldAlert },
}

function haceCuanto(iso: string): string | null {
  const ms = Date.now() - Date.parse(iso)
  if (Number.isNaN(ms) || ms < 0) return null
  const min = Math.round(ms / 60000)
  if (min < 1) return 'hace un momento'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} d`
}

/** Secreto aleatorio de 40 caracteres hexadecimales: sin símbolos que se corten al copiar. */
function generarSecreto(): string {
  const bytes = new Uint8Array(20)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function copiar(texto: string, ok: string) {
  navigator.clipboard
    ?.writeText(texto)
    .then(() => toast.success(ok))
    .catch(() => toast.error('No se pudo copiar: selecciónalo y cópialo a mano'))
}

/**
 * CÓMO CONECTARLO. Lo que más se pierde al conectar una herramienta no es la dirección, es el secreto:
 * la gente no sabe en qué DOS sitios se pone ni que tiene que ser idéntico. Aquí se dice siempre, con
 * la ruta de menús del proveedor, un generador cuando el secreto lo eliges tú y qué significa cada
 * respuesta cuando algo no llega.
 */
function GuiaConexionWebhook({ w }: { w: WebhookEntranteEstado }) {
  const [generado, setGenerado] = useState<string | null>(null)
  const g = w.guia
  return (
    <div className="mt-3 space-y-2 rounded-md border border-brand-500/20 bg-brand-500/5 p-3 text-xs">
      <p className="text-foreground font-medium">Cómo conectarlo</p>
      <ol className="text-muted-foreground list-decimal space-y-1.5 pl-4">
        <li>
          <span className="text-foreground">Dónde se crea:</span> {g.donde}
        </li>
        <li>
          <span className="text-foreground">El secreto (en dos sitios, idéntico):</span> {g.secreto}
        </li>
        <li>
          <span className="text-foreground">Cómo probarlo:</span> {g.prueba}
        </li>
      </ol>
      {g.secretoLoEligesTu ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={() => setGenerado(generarSecreto())}>
            <Wand2 className="mr-1.5 h-3.5 w-3.5" />
            Generar un secreto
          </Button>
          {generado ? (
            <>
              <code className="bg-background/60 border-border rounded border px-2 py-1 select-all">{generado}</code>
              <Button type="button" variant="outline" size="sm" onClick={() => copiar(generado, 'Secreto copiado')}>
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Copiar
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {generado ? (
        <p className="text-amber-400">
          Este valor solo se muestra aquí: pégalo ahora en el proveedor y en el campo del secreto de esta ficha, y
          guarda. Si lo cierras sin guardarlo, genera otro.
        </p>
      ) : null}
      <details className="pt-1">
        <summary className="text-muted-foreground hover:text-foreground cursor-pointer">Si no llega nada</summary>
        <ul className="text-muted-foreground mt-1.5 list-disc space-y-1 pl-4">
          <li>
            <span className="text-foreground">El proveedor dice «200»:</span> la app lo aceptó. Mira «Último evento»
            aquí; si no cambia, avísanos con la hora exacta.
          </li>
          <li>
            <span className="text-foreground">Dice «401» o aparece «Último rechazo de firma»:</span> el secreto no es
            idéntico en los dos sitios (un espacio de más, o falta pegarlo aquí y guardar). Vuelve a pegarlo en ambos.
          </li>
          <li>
            <span className="text-foreground">Dice «404» o error de conexión:</span> la dirección está mal. Usa el botón
            Copiar de arriba en vez de escribirla.
          </li>
          <li>
            <span className="text-foreground">El proveedor no muestra ninguna entrega:</span> el webhook está apagado o
            no se ha provocado el evento (en muchos proveedores la vista previa no cuenta).
          </li>
        </ul>
      </details>
    </div>
  )
}

function FilaWebhook({ w, tenant }: { w: WebhookEntranteEstado; tenant: string }) {
  const url = `${typeof window === 'undefined' ? '' : window.location.origin}${w.path.replace('{tenant}', tenant)}`
  const meta = SECRET_META[w.secret.estado]
  const Icono = meta.icono
  const ultima = w.ultimoEvento ? haceCuanto(w.ultimoEvento.fecha) : null

  return (
    <div className="rounded-lg border border-border bg-card/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{w.titulo}</p>
          <p className="text-muted-foreground mt-0.5 text-xs">{w.descripcion}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${meta.clase}`}>
          <Icono className="h-3.5 w-3.5" />
          {meta.etiqueta}
        </span>
      </div>

      {/* URL exacta de esta subcuenta, con copiar. Construir la URL a mano es donde se cuela la
          errata que luego cuesta una tarde — el mismo motivo que la guía de GHL la pinta montada. */}
      <div className="mt-3 flex items-center gap-2">
        <code className="bg-background/60 border-border flex-1 overflow-x-auto rounded border px-2 py-1.5 text-xs">
          {url}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            navigator.clipboard
              ?.writeText(url)
              .then(() => toast.success('Dirección copiada'))
              .catch(() => toast.error('No se pudo copiar: selecciónala y cópiala a mano'))
          }}
        >
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Copiar
        </Button>
      </div>

      <div className="text-muted-foreground mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
        <span>
          Método: <code className="text-foreground">{w.metodo}</code>
        </span>
        <span>
          Cabecera o firma: <code className="text-foreground">{w.auth.nombre}</code>
          {w.auth.tipo === 'firma' ? ' (firmada por el proveedor)' : ''}
        </span>
        <span>Eventos: {w.eventos.join(', ')}</span>
        <span className="flex items-center gap-1">
          <Radio className="h-3 w-3" aria-hidden />
          Último evento:{' '}
          {w.ultimoEvento ? (
            <span className="text-foreground">{ultima ?? formatDateTime(w.ultimoEvento.fecha)}</span>
          ) : (
            <span className="text-foreground">— (nunca ha llegado ninguno)</span>
          )}
        </span>
      </div>
      {w.ultimoEvento ? (
        <p className="text-muted-foreground/70 mt-1 text-2xs">Evidencia: {w.ultimoEvento.evidencia}</p>
      ) : null}
      {w.ultimoRechazo ? (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-400">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Último rechazo de firma: {haceCuanto(w.ultimoRechazo.fecha) ?? formatDateTime(w.ultimoRechazo.fecha)} — revisa
          el signing secret en el proveedor.
        </p>
      ) : null}
      {w.aviso ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs text-amber-400">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {w.aviso}
        </p>
      ) : null}
      {w.secret.pista ? <p className="text-muted-foreground mt-2 text-xs">{w.secret.pista}</p> : null}
      <GuiaConexionWebhook w={w} />
      {w.doc ? (
        <a
          href={w.doc}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs text-brand-400 hover:underline"
        >
          Cómo configurarlo (limitaciones incluidas) <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  )
}

/** Webhooks de una aplicación, dentro de su propia ficha: conexión y tiempo real en un solo sitio. */
export function ProviderWebhooks({
  webhooks,
  tenant,
  groupId,
}: {
  webhooks: WebhookEntranteEstado[]
  tenant: string
  groupId: string
}) {
  const propios = webhooks.filter((webhook) => webhook.groupId === groupId)
  if (!propios.length) return null

  return (
    <section className="border-border my-5 space-y-3 border-y py-4">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Radio className="h-4 w-4" aria-hidden />
          Eventos en tiempo real
        </h2>
        <p className="text-muted-foreground mt-1 text-xs">
          Configura estas direcciones en el proveedor. El estado y la última entrega proceden de evidencia real.
        </p>
      </div>
      <div className="space-y-3">
        {propios.map((webhook) => (
          <FilaWebhook key={webhook.id} w={webhook} tenant={tenant} />
        ))}
      </div>
      {!propios.some((webhook) => webhook.ultimoEvento) ? (
        <p className="text-muted-foreground text-xs">
          Todavía no hay entregas registradas. Las cargas históricas pueden seguir aportando datos; el webhook añade las
          actualizaciones en tiempo real.
        </p>
      ) : null}
    </section>
  )
}
