'use client'

import { useMemo, useState } from 'react'
import { CalendarDays, ChevronDown, Filter, Repeat2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCurrency } from '@/lib/utils'
import { claveMes, construirResumenMensual, type GrupoComision, type MesComision } from '@/lib/commissions/mensual'
import type { CommissionDashboardRow } from '@/lib/commissions/dashboard'
import type { FilaFutura } from '@/lib/commissions/future-response'
import type { ParticipantType } from '@/lib/types/database'

const ROLE_LABEL: Record<ParticipantType, string> = {
  setter: 'Setter',
  closer: 'Closer',
  affiliate: 'Colaborador',
  collaborator: 'Colaborador',
}

const nombreMes = (key: string) => {
  const [y, m] = key.split('-').map(Number)
  const mes = new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long' })
  return `${mes.charAt(0).toUpperCase()}${mes.slice(1)} ${y}`
}

type Persona = { id: string; name: string }

function Importe({ value, className = '' }: { value: number; className?: string }) {
  return <span className={`tabular-nums ${value < 0 ? 'text-red-400' : ''} ${className}`}>{formatCurrency(value)}</span>
}

function GrupoDetalle({
  titulo,
  ayuda,
  icono,
  acento,
  grupo,
  vacio,
  plano = false,
}: {
  titulo: string
  ayuda: string
  icono: React.ReactNode
  acento: string
  grupo: GrupoComision
  vacio: string
  /** Una sola persona (su propia vista): se listan los clientes directamente, sin nivel de persona. */
  plano?: boolean
}) {
  const clientesPlanos = grupo.personas
    .flatMap((p) => p.clientes)
    .reduce<{ saleId: string | null; contact: string; amount: number }[]>((acc, c) => {
      const previo = acc.find((x) => x.saleId === c.saleId && x.contact === c.contact)
      if (previo) previo.amount += c.amount
      else acc.push({ ...c })
      return acc
    }, [])
    .sort((a, b) => b.amount - a.amount || a.contact.localeCompare(b.contact))
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background/40">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className={`flex items-center gap-2 text-sm font-medium ${acento}`}>
            {icono}
            {titulo}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{ayuda}</p>
        </div>
        <p className="shrink-0 font-display text-xl font-semibold tabular-nums text-foreground">
          {formatCurrency(grupo.amount)}
        </p>
      </div>

      {grupo.personas.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{vacio}</p>
      ) : plano ? (
        <ul className="divide-y divide-border">
          {clientesPlanos.map((c) => (
            <li
              key={`${c.saleId ?? 'sin-venta'}-${c.contact}`}
              className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <span className="truncate text-foreground">{c.contact}</span>
              <Importe value={c.amount} className="font-medium text-foreground" />
            </li>
          ))}
          {grupo.prevista > 0 && (
            <li className="px-4 py-2 text-xs text-amber-400">
              {formatCurrency(grupo.prevista)} son cuotas que el cliente aún tiene que pagar
            </li>
          )}
        </ul>
      ) : (
        <ul className="divide-y divide-border">
          {grupo.personas.map((p) => (
            <li key={`${p.userId}-${p.participantType}`} className="px-4 py-2.5">
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-2">
                    <ChevronDown
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                    <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {ROLE_LABEL[p.participantType] ?? p.participantType}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-medium">
                    <Importe value={p.amount} className="text-foreground" />
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      {p.clientes.length} {p.clientes.length === 1 ? 'cliente' : 'clientes'}
                    </span>
                  </span>
                </summary>
                <ul className="mt-2 space-y-1 border-l border-border pl-4 ml-1.5">
                  {p.clientes.map((c) => (
                    <li
                      key={`${c.saleId ?? 'sin-venta'}-${c.contact}`}
                      className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
                    >
                      <span className="truncate">{c.contact}</span>
                      <Importe value={c.amount} />
                    </li>
                  ))}
                  {p.prevista > 0 && (
                    <li className="pt-1 text-xs text-amber-400">
                      {formatCurrency(p.prevista)} son cuotas aún por cobrar al cliente (previsión)
                    </li>
                  )}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function CommissionMonthlyStatement({
  rows,
  basis,
  future,
  futureError,
  loading,
  personas,
  selectedMemberId,
  esEquipo,
  onSelectMember,
  onFilterMonth,
  onRetryFuture,
  personal = false,
  impagos = 0,
}: {
  /** Comisiones acotadas por persona/tipo/búsqueda — nunca por fecha: aquí el eje es el mes. */
  rows: CommissionDashboardRow[]
  /** Todas las comisiones visibles (para saber cuál fue el primer cobro de cada venta). */
  basis: CommissionDashboardRow[]
  future: FilaFutura[]
  futureError: string | null
  loading: boolean
  /** Personas elegibles como atajo. Vacío = no se muestra el selector (p. ej. un colaborador). */
  personas: Persona[]
  selectedMemberId: string
  /** Vista del equipo completo (admin sin persona elegida): se habla de «por pagar», no de «por cobrar». */
  esEquipo: boolean
  onSelectMember: (id: string) => void
  /** Filtra el listado de abajo por un mes de liquidación. Si no se pasa, no se muestra el botón. */
  onFilterMonth?: (month: string) => void
  onRetryFuture: () => void
  /** Vista de UNA persona sobre sí misma (colaborador): «Mis comisiones», lista plana por cliente. */
  personal?: boolean
  /** Comisión proyectada de cuotas vencidas sin cobrar: no suma en ningún mes, se avisa aparte. */
  impagos?: number
}) {
  const meses = useMemo(() => construirResumenMensual(rows, future, basis), [rows, future, basis])
  const actual = claveMes()
  const futuros = meses.filter((m) => m.month >= actual)
  const pasados = meses.filter((m) => m.month < actual).reverse()
  const [verPasados, setVerPasados] = useState(false)
  const [verMasFuturos, setVerMasFuturos] = useState(false)
  // null = por defecto el mes en curso; '' = el usuario cerró el detalle; 'YYYY-MM' = mes elegido.
  const [elegido, setElegido] = useState<string | null>(null)

  const abierto = elegido === null ? actual : elegido
  const persona = personas.find((p) => p.id === selectedMemberId)
  const hayAjustes = meses.some((m) => m.ajuste.amount !== 0)
  // Vista de equipo = lo que HAY QUE PAGAR; vista de una persona = lo que ELLA tiene por cobrar.
  const porX = esEquipo ? 'Por pagar' : 'Por cobrar'
  const porx = porX.toLowerCase()
  // Meses futuros: el en curso + 5 más; el resto bajo demanda para no empujar el detalle fuera de pantalla.
  const LIMITE_FUTUROS = 6
  const futurosVisibles = verMasFuturos ? futuros : futuros.slice(0, LIMITE_FUTUROS)

  const detalle = (m: MesComision) => (
    <div className="space-y-4 border-t border-border bg-muted/10 px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            <span>{nombreMes(m.month)}</span>
          </p>
          <p className="mt-1 font-display text-3xl font-semibold tabular-nums text-foreground">
            {formatCurrency(m.porCobrar)}
            <span className="ml-2 text-sm font-normal text-muted-foreground">{porx}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Total {formatCurrency(m.total)} · ya pagado {formatCurrency(m.pagado)}
            {m.prevista > 0 && ` · ${formatCurrency(m.prevista)} dependen de que el cliente pague su cuota`}
          </p>
        </div>
        {onFilterMonth && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => onFilterMonth(m.month)}
          >
            <Filter className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Ver estas comisiones abajo
          </Button>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GrupoDetalle
          titulo="Venta nueva"
          ayuda="Primer cobro de cada venta: clientes que entran este mes."
          icono={<Sparkles className="h-4 w-4" aria-hidden="true" />}
          acento="text-emerald-400"
          grupo={m.nuevo}
          vacio="Ninguna venta nueva comisiona este mes."
          plano={personal}
        />
        <GrupoDetalle
          titulo="Recurrencia"
          ayuda="Cuotas posteriores de ventas ya cerradas."
          icono={<Repeat2 className="h-4 w-4" aria-hidden="true" />}
          acento="text-sky-400"
          grupo={m.recurrente}
          vacio="No hay cuotas recurrentes este mes."
          plano={personal}
        />
      </div>

      {hayAjustes && m.ajuste.amount !== 0 && (
        <GrupoDetalle
          titulo="Ajustes y devoluciones"
          ayuda="Restan del total. No son venta nueva ni recurrencia."
          icono={<Filter className="h-4 w-4" aria-hidden="true" />}
          acento="text-red-400"
          grupo={m.ajuste}
          vacio=""
          plano={personal}
        />
      )}
    </div>
  )

  const fila = (m: MesComision) => {
    const activa = abierto === m.month
    const esActual = m.month === actual
    const esFuturo = m.month > actual
    return (
      <li key={m.month}>
        <button
          type="button"
          onClick={() => setElegido(activa ? '' : m.month)}
          aria-expanded={activa}
          className={`grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-l-2 px-4 py-3 text-left transition-colors sm:grid-cols-[minmax(190px,1.6fr)_repeat(4,minmax(90px,1fr))] ${
            activa ? 'border-l-brand-500 bg-brand-500/10' : 'border-l-transparent hover:bg-muted/40'
          }`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${activa ? 'rotate-180' : '-rotate-90'}`}
              aria-hidden="true"
            />
            <span className="whitespace-nowrap text-sm font-medium text-foreground">{nombreMes(m.month)}</span>
            {esActual && (
              <span className="shrink-0 rounded-full bg-brand-500/20 px-2 py-0.5 text-xs text-brand-300">Este mes</span>
            )}
            {esFuturo && m.prevista > 0 && (
              <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400">Prevista</span>
            )}
          </span>
          <span className="text-right text-sm font-semibold sm:order-last sm:text-base">
            <Importe value={m.porCobrar} className={m.porCobrar > 0 ? 'text-amber-400' : 'text-muted-foreground'} />
          </span>
          <span className="col-span-2 grid grid-cols-3 gap-2 pl-6 text-xs sm:hidden">
            <span>
              <span className="block text-muted-foreground">Nueva</span>
              <Importe value={m.nuevo.amount} className="text-emerald-400" />
            </span>
            <span>
              <span className="block text-muted-foreground">Recurrencia</span>
              <Importe value={m.recurrente.amount} className="text-sky-400" />
            </span>
            <span>
              <span className="block text-muted-foreground">Pagado</span>
              <Importe value={m.pagado} className="text-muted-foreground" />
            </span>
          </span>
          <span className="hidden text-right text-sm sm:block">
            <Importe value={m.nuevo.amount} className="text-emerald-400" />
          </span>
          <span className="hidden text-right text-sm sm:block">
            <Importe value={m.recurrente.amount} className="text-sky-400" />
          </span>
          <span className="hidden text-right text-sm text-muted-foreground sm:block">
            <Importe value={m.pagado} />
          </span>
        </button>
        {activa && detalle(m)}
      </li>
    )
  }

  const cabecera = (
    <div className="hidden grid-cols-[minmax(190px,1.6fr)_repeat(4,minmax(90px,1fr))] gap-x-4 border-b border-border bg-muted/20 px-4 py-2 text-xs font-medium text-muted-foreground sm:grid">
      <span>Mes de pago</span>
      <span className="text-right">Venta nueva</span>
      <span className="text-right">Recurrencia</span>
      <span className="text-right">Ya pagado</span>
      <span className="text-right">{porX}</span>
    </div>
  )

  return (
    <section className="dashboard-surface overflow-hidden" aria-labelledby="mensual-heading" aria-busy={loading}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-brand-400">Mes a mes</p>
          <h2 id="mensual-heading" className="mt-1 font-display text-xl font-semibold text-foreground">
            {personal
              ? 'Mis comisiones'
              : persona
                ? `Comisión por cobrar de ${persona.name}`
                : esEquipo
                  ? 'Comisión por pagar al equipo'
                  : 'Comisión por cobrar'}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {personal ? (
              <>
                Una fila por mes. Pulsa un mes para ver qué clientes te la generan:{' '}
                <span className="text-emerald-400">venta nueva</span> (su primer pago) o{' '}
                <span className="text-sky-400">recurrencia</span> (sus pagos siguientes). Cada mes es cuando se paga: lo
                que tu cliente abona en octubre lo cobras en noviembre.
              </>
            ) : (
              <>
                Pulsa un mes para ver de dónde viene: <span className="text-emerald-400">venta nueva</span> (primer
                cobro de una venta) o <span className="text-sky-400">recurrencia</span> (cuotas posteriores), y quién la
                genera. Cada mes es el de pago: lo que el cliente abona en octubre se paga en noviembre.
              </>
            )}
          </p>
        </div>
      </div>

      {personas.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3 sm:px-6">
          <span className="text-xs text-muted-foreground">Ver:</span>
          {[{ id: 'all', name: 'Todo el equipo' }, ...personas].map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={selectedMemberId === p.id}
              onClick={() => onSelectMember(p.id)}
              className={`h-7 rounded-full border px-3 text-xs font-medium transition-colors ${
                selectedMemberId === p.id
                  ? 'border-brand-500 bg-brand-500 text-white'
                  : 'border-border bg-transparent text-muted-foreground hover:border-brand-500/50 hover:text-foreground'
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {futureError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-red-500/30 bg-red-500/10 px-5 py-2.5 text-sm sm:px-6"
        >
          <span>
            <span className="font-medium text-red-300">No se pudieron leer las cuotas por cobrar</span>{' '}
            <span className="text-muted-foreground">
              ({futureError}) — los meses siguientes no incluyen la previsión y sus importes no son fiables.
            </span>
          </span>
          <button
            type="button"
            onClick={onRetryFuture}
            className="shrink-0 text-xs font-medium underline hover:text-foreground"
          >
            Reintentar
          </button>
        </div>
      )}

      {impagos > 0 && !futureError && (
        <div role="note" className="border-b border-amber-500/30 bg-amber-500/10 px-5 py-2.5 text-sm sm:px-6">
          <span className="font-medium text-amber-300">{formatCurrency(impagos)} sin cobrar por impago.</span>{' '}
          <span className="text-muted-foreground">
            {personal ? 'Son cuotas vencidas que tus clientes' : 'Son cuotas vencidas que los clientes'} todavía no han
            pagado. No cuentan en ningún mes hasta que paguen.
          </span>
        </div>
      )}

      {loading ? (
        <div className="space-y-2 p-5">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : (
        <>
          {cabecera}
          <ul className="divide-y divide-border">{futurosVisibles.map(fila)}</ul>
          {futuros.length > LIMITE_FUTUROS && (
            <button
              type="button"
              onClick={() => setVerMasFuturos((v) => !v)}
              className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground"
              aria-expanded={verMasFuturos}
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${verMasFuturos ? 'rotate-180' : ''}`} />
              {verMasFuturos ? 'Ver menos meses' : `Ver ${futuros.length - LIMITE_FUTUROS} meses más`}
            </button>
          )}

          {pasados.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setVerPasados((v) => !v)}
                className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground"
                aria-expanded={verPasados}
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${verPasados ? 'rotate-180' : ''}`} />
                {verPasados ? 'Ocultar meses anteriores' : `Ver meses anteriores (${pasados.length})`}
              </button>
              {verPasados && <ul className="divide-y divide-border border-t border-border">{pasados.map(fila)}</ul>}
            </>
          )}
        </>
      )}
    </section>
  )
}
