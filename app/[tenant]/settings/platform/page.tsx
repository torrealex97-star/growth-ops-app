'use client'

import Link from 'next/link'
import { ArrowLeft, ArrowUpRight, Bot, Building2, Eye, Settings2, SlidersHorizontal } from 'lucide-react'
import { EstadoPanel } from '@/components/ui/carga/EstadoPanel'
import { useSesion, useTenant } from '@/lib/tenant-context'

const CARD_CLASS =
  'group flex min-h-32 items-start gap-4 rounded-xl border border-border bg-card p-5 text-left transition-colors hover:border-brand-500/35 hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function PlatformControlPage() {
  const tenant = useTenant()
  const sesion = useSesion()

  if (!sesion) return <EstadoPanel estado="cargando" que="el control de plataforma" filasSkeleton={3} />
  if (!sesion.isSuperAdmin) return <EstadoPanel estado="sin_permiso" que="el control global de plataforma" />

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <Link
          href={`/${tenant}/settings`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Volver a Configuración
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-brand-400">
              <Settings2 className="h-5 w-5" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-[0.14em]">Super Admin</span>
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
              Control de plataforma
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Accesos centrales que no pertenecen a una sola subcuenta. Las acciones específicas de negocio siguen
              dentro del tenant seleccionado para evitar mezclar datos.
            </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-right">
            <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Tenant actual</p>
            <p className="mt-0.5 max-w-48 truncate text-sm font-medium text-foreground">{tenant}</p>
          </div>
        </div>
      </header>

      <section className="space-y-3" aria-labelledby="alcance-global">
        <div>
          <h2 id="alcance-global" className="text-base font-semibold text-foreground">
            Alcance global
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Se mantiene aunque cambies de subcuenta.</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Link href={`/${tenant}/settings/subcuentas`} className={CARD_CLASS}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400">
              <Building2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">Subcuentas</span>
                <ArrowUpRight
                  className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground"
                  aria-hidden="true"
                />
              </span>
              <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                Crear, revisar, archivar y gestionar miembros de todos los tenants.
              </span>
              <span className="mt-3 inline-flex rounded bg-violet-500/10 px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-violet-400">
                Global
              </span>
            </span>
          </Link>

          <Link href={`/${tenant}/settings/mcp`} className={CARD_CLASS}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-fuchsia-500/10 text-fuchsia-400">
              <Bot className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">Conexiones IA (MCP)</span>
                <ArrowUpRight
                  className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground"
                  aria-hidden="true"
                />
              </span>
              <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                Ver y revocar asistentes autorizados por tu usuario para consultar las subcuentas permitidas.
              </span>
              <span className="mt-3 inline-flex rounded bg-fuchsia-500/10 px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-fuchsia-400">
                Global por usuario
              </span>
            </span>
          </Link>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="alcance-tenant">
        <div>
          <h2 id="alcance-tenant" className="text-base font-semibold text-foreground">
            Operar el tenant actual
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Estas acciones se aplican solo a <span className="font-medium text-foreground">{tenant}</span>.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Link href={`/${tenant}/settings/users`} className={CARD_CLASS}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400">
              <Eye className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">Usuarios y “Ver como”</span>
                <ArrowUpRight
                  className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground"
                  aria-hidden="true"
                />
              </span>
              <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                Comprueba exactamente qué ve una persona de la subcuenta seleccionada.
              </span>
              <span className="mt-3 inline-flex rounded bg-blue-500/10 px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-blue-400">
                Tenant actual
              </span>
            </span>
          </Link>

          <Link href={`/${tenant}/settings`} className={CARD_CLASS}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10 text-cyan-400">
              <SlidersHorizontal className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">Configuración de la subcuenta</span>
                <ArrowUpRight
                  className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-foreground"
                  aria-hidden="true"
                />
              </span>
              <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                Integraciones, Data Health, productos, comisiones y equipo del tenant actual.
              </span>
              <span className="mt-3 inline-flex rounded bg-cyan-500/10 px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-cyan-400">
                Tenant actual
              </span>
            </span>
          </Link>
        </div>
      </section>
    </div>
  )
}
