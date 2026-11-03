'use client'

// PIEZAS VISUALES del panel del colaborador. Todas son de PRESENTACIÓN: reciben datos ya calculados por
// lib/collaborators/panel.ts (lógica pura y testeada) y no deciden nada de dinero.
// Encodings (skill data-visualization-pro): longitud/posición sobre color; el color nunca es la única señal
// (cada barra y cada fila llevan su etiqueta/importe en texto); tokens de diseño, nada de hex.
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, ExternalLink, FileText } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import { etiquetaMesLarga, nombreDeMes } from '@/lib/commissions/meses'
import type { EmbudoMes, EstadoImpago, FilaHistorial, FilaPrevision } from '@/lib/collaborators/panel'

const eur = (n: number) => formatCurrency(n)
const mayus = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

// ── Gráfico: 12 meses, venta nueva + recurrencia apiladas ────────────────────────────────────

export function GraficoMeses({
  serie,
  mes,
  onMes,
}: {
  serie: { month: string; nuevo: number; recurrente: number }[]
  mes: string
  onMes: (ym: string) => void
}) {
  const datos = serie.map((s) => ({ ...s, etiqueta: mayus(nombreDeMes(s.month)).slice(0, 3) }))
  const total = serie.reduce((a, s) => a + s.nuevo + s.recurrente, 0)
  return (
    <section className="dashboard-card" aria-labelledby="grafico-meses">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="grafico-meses" className="font-display text-base font-semibold text-foreground">
            Tus últimos 12 meses
          </h2>
          <p className="text-xs text-muted-foreground">
            Cada barra es un mes de actividad. Pulsa una barra para verlo arriba.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'hsl(var(--brand-500))' }} aria-hidden />{' '}
            Venta nueva
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ background: 'hsl(var(--brand-500) / 0.35)' }}
              aria-hidden
            />{' '}
            Recurrencia
          </span>
        </div>
      </div>
      {total === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Aún no hay comisiones generadas.</p>
      ) : (
        <div className="h-56" role="img" aria-label="Comisión generada por mes, venta nueva y recurrencia">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={datos} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="etiqueta"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              />
              <YAxis
                width={44}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                tickFormatter={(v: number) => `${v} €`}
              />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted) / 0.4)' }}
                contentStyle={{
                  background: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(_l, p) => mayus(etiquetaMesLarga(String(p?.[0]?.payload?.month ?? '')))}
                formatter={(v, n) => [eur(Number(v)), n === 'nuevo' ? 'Venta nueva' : 'Recurrencia']}
              />
              <Bar
                dataKey="nuevo"
                stackId="m"
                fill="hsl(var(--brand-500))"
                radius={[0, 0, 0, 0]}
                cursor="pointer"
                onClick={(d) => {
                  const m = (d as unknown as { month?: string }).month
                  if (m) onMes(m)
                }}
              />
              <Bar
                dataKey="recurrente"
                stackId="m"
                fill="hsl(var(--brand-500) / 0.35)"
                radius={[4, 4, 0, 0]}
                cursor="pointer"
                onClick={(d) => {
                  const m = (d as unknown as { month?: string }).month
                  if (m) onMes(m)
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Ver como tabla</summary>
        <table className="mt-2 w-full text-left">
          <thead>
            <tr>
              <th className="py-1 font-medium">Mes</th>
              <th className="py-1 text-right font-medium">Venta nueva</th>
              <th className="py-1 text-right font-medium">Recurrencia</th>
            </tr>
          </thead>
          <tbody>
            {serie.map((s) => (
              <tr key={s.month} className={s.month === mes ? 'text-foreground' : ''}>
                <td className="py-0.5">{mayus(etiquetaMesLarga(s.month))}</td>
                <td className="py-0.5 text-right tabular-nums">{eur(s.nuevo)}</td>
                <td className="py-0.5 text-right tabular-nums">{eur(s.recurrente)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}

// ── Registro de meses: generado, pagado, factura, y total desde el inicio ────────────────────

export function RegistroMeses({
  filas,
  total,
  mes,
  onMes,
  onAbrirFactura,
}: {
  filas: FilaHistorial[]
  total: { generado: number; pagado: number; porCobrar: number }
  mes: string
  onMes: (ym: string) => void
  onAbrirFactura: (ruta: string) => void
}) {
  const [todo, setTodo] = useState(false)
  const visibles = todo ? filas : filas.slice(0, 6)
  return (
    <section className="dashboard-surface overflow-hidden" aria-labelledby="registro-meses">
      <div className="border-b border-border px-5 py-4 sm:px-6">
        <h2 id="registro-meses" className="font-display text-base font-semibold text-foreground">
          Registro de meses
        </h2>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Dato titulo="Generado desde el inicio" valor={eur(total.generado)} />
          <Dato titulo="Ya cobrado" valor={eur(total.pagado)} tono="ok" />
          <Dato titulo="Por cobrar" valor={eur(total.porCobrar)} tono={total.porCobrar > 0 ? 'aviso' : undefined} />
        </div>
      </div>
      {filas.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground sm:px-6">Todavía no hay meses con comisión.</p>
      ) : (
        <ul className="divide-y divide-border">
          {visibles.map((f) => (
            <li
              key={f.month}
              className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 sm:px-6 ${f.month === mes ? 'bg-brand-500/5' : ''}`}
            >
              <button
                type="button"
                onClick={() => onMes(f.month)}
                className="min-w-[8.5rem] text-left text-sm font-medium text-foreground hover:text-brand-300"
                aria-current={f.month === mes ? 'true' : undefined}
              >
                {mayus(etiquetaMesLarga(f.month))}
              </button>
              <span className="tabular-nums text-sm text-foreground">{eur(f.generado)}</span>
              <span className="text-xs text-muted-foreground">
                {f.porCobrar <= 0 ? (
                  <span className="inline-flex items-center gap-1 text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Cobrado
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-400">
                    <Clock className="h-3.5 w-3.5" aria-hidden /> Por cobrar {eur(f.porCobrar)}
                  </span>
                )}
              </span>
              <span className="ml-auto flex items-center gap-2 text-xs">
                {f.factura ? (
                  <>
                    <FileText className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                    <span className={f.factura.status === 'pagada' ? 'text-emerald-400' : 'text-amber-400'}>
                      Factura {f.factura.status === 'pagada' ? 'pagada' : 'recibida'}
                      {f.factura.amount != null ? ` · ${eur(Number(f.factura.amount))}` : ''}
                    </span>
                    {f.factura.invoice_url && (
                      <button
                        type="button"
                        onClick={() => onAbrirFactura(f.factura!.invoice_url!)}
                        className="inline-flex items-center gap-1 text-brand-400 hover:text-brand-300"
                      >
                        Ver <ExternalLink className="h-3 w-3" aria-hidden />
                      </button>
                    )}
                  </>
                ) : f.generado > 0 ? (
                  <span className="text-muted-foreground">Sin factura</span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {filas.length > 6 && (
        <button
          type="button"
          onClick={() => setTodo((v) => !v)}
          aria-expanded={todo}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${todo ? 'rotate-180' : ''}`} aria-hidden />
          {todo ? 'Ver menos' : `Ver todos los meses (${filas.length})`}
        </button>
      )}
    </section>
  )
}

function Dato({ titulo, valor, tono }: { titulo: string; valor: string; tono?: 'ok' | 'aviso' }) {
  return (
    <div>
      <p className="text-2xs uppercase tracking-[0.08em] text-muted-foreground">{titulo}</p>
      <p
        className={`mt-0.5 font-display text-lg font-semibold tabular-nums ${
          tono === 'ok' ? 'text-emerald-400' : tono === 'aviso' ? 'text-amber-400' : 'text-foreground'
        }`}
      >
        {valor}
      </p>
    </div>
  )
}

// ── Previsión (aparte de lo generado) ────────────────────────────────────────────────────────

export function PrevisionPanel({
  filas,
  error,
  onReintentar,
}: {
  filas: FilaPrevision[]
  error: string | null
  onReintentar: () => void
}) {
  const max = Math.max(1, ...filas.map((f) => f.importe))
  return (
    <section className="dashboard-card" aria-labelledby="prevision">
      <h2 id="prevision" className="font-display text-base font-semibold text-foreground">
        Previsión
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Lo que generarías los próximos meses{' '}
        <strong className="font-medium text-foreground">si tus clientes siguen pagando</strong>. No es dinero cobrado:
        no cuenta en tu registro hasta que paguen.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          No se pudo leer la previsión ({error}).{' '}
          <button type="button" onClick={onReintentar} className="underline">
            Reintentar
          </button>
        </p>
      ) : filas.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hay cuotas pendientes de cobro.</p>
      ) : (
        <ul className="space-y-2">
          {filas.map((f) => (
            <li key={f.month} className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-3 text-sm">
              <span className="text-foreground">{mayus(etiquetaMesLarga(f.month))}</span>
              <span className="h-2 rounded-full bg-muted" aria-hidden>
                <span
                  className="block h-2 rounded-full"
                  style={{
                    width: `${Math.max(4, (f.importe / max) * 100)}%`,
                    background: 'hsl(var(--brand-500) / 0.6)',
                  }}
                />
              </span>
              <span className="tabular-nums text-foreground">{eur(f.importe)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Clientes con impago y su estado en Stripe ────────────────────────────────────────────────

export type ImpagoVista = {
  installmentId: string
  cliente: string
  vencimiento: string
  comision: number
  estado: EstadoImpago | null
}

export function ClientesConImpago({ filas, cargando }: { filas: ImpagoVista[]; cargando: boolean }) {
  if (!cargando && filas.length === 0) return null
  return (
    <section className="dashboard-card border-amber-500/30" aria-labelledby="impagos">
      <h2 id="impagos" className="flex items-center gap-2 font-display text-base font-semibold text-foreground">
        <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden /> Clientes con pagos pendientes
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Cuotas vencidas que aún no se han cobrado. Tu comisión llega en cuanto el cliente paga.
      </p>
      <ul className="divide-y divide-border">
        {filas.map((f) => (
          <li key={f.installmentId} className="py-2.5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-foreground">{f.cliente}</span>
              <span className="text-xs text-muted-foreground">
                Venció el {new Date(f.vencimiento).toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} · tu
                comisión <span className="tabular-nums text-foreground">{eur(f.comision)}</span>
              </span>
            </div>
            <p
              className={`mt-0.5 text-xs ${
                f.estado?.tipo === 'pagado_pendiente_registro'
                  ? 'text-emerald-400'
                  : f.estado?.tipo === 'pago_rechazado'
                    ? 'text-red-400'
                    : 'text-muted-foreground'
              }`}
            >
              {f.estado ? f.estado.texto : cargando ? 'Consultando Stripe…' : 'Estado no disponible'}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ── Embudo desde las agendas ─────────────────────────────────────────────────────────────────

export function EmbudoAgendas({ embudo, mes, cargando }: { embudo: EmbudoMes; mes: string; cargando: boolean }) {
  const etapas = [
    { n: 'Agendas', v: embudo.agendas, nota: 'Llamadas agendadas en el mes' },
    { n: 'Asistieron', v: embudo.asistieron, nota: `${embudo.pctAsistencia}% de las agendas` },
    { n: 'Ventas', v: embudo.ventas, nota: `${embudo.pctVenta}% de los que asistieron · ${eur(embudo.importe)}` },
  ]
  const max = Math.max(1, embudo.agendas)
  return (
    <section className="dashboard-card" aria-labelledby="embudo-heading" aria-busy={cargando}>
      <h2 id="embudo-heading" className="font-display text-base font-semibold text-foreground">
        Mi embudo · {mayus(etiquetaMesLarga(mes))}
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Empieza en las agendas: lo que pasa con cada llamada que te llega.
      </p>
      <ul className="space-y-3">
        {etapas.map((e) => (
          <li key={e.n}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-foreground">{e.n}</span>
              <span className="font-display text-lg font-semibold tabular-nums text-foreground">{e.v}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-muted" aria-hidden>
              <div
                className="h-2 rounded-full"
                style={{
                  width: `${e.v === 0 ? 0 : Math.max(3, (e.v / max) * 100)}%`,
                  background: 'hsl(var(--brand-500))',
                }}
              />
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{e.nota}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted-foreground">
        {embudo.noAsistieron} no asistieron · {embudo.canceladas} canceladas · {embudo.pendientes} pendientes
      </p>
    </section>
  )
}
