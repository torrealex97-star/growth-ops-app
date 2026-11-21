'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatNumber } from '@/lib/utils'
import { diaCorto } from './tipos'

// Apuntados y confirmados por día. Dos series de la MISMA unidad (personas) en un solo eje. Colores
// por tokens de la subcuenta (nunca hex) y leyenda con texto y total: el color no es el único
// encoding. Debajo va la misma serie como tabla para lectores de pantalla.
const COLOR_APUNTADOS = 'hsl(var(--brand-500) / 0.85)'
const COLOR_CONFIRMADOS = 'hsl(var(--brand-300) / 0.9)'

export function GraficaApuntados({ dias }: { dias: { fecha: string; leads: number; confirmados: number }[] }) {
  const totalLeads = dias.reduce((a, d) => a + d.leads, 0)
  const totalConfirmados = dias.reduce((a, d) => a + d.confirmados, 0)

  return (
    <section aria-labelledby="titulo-dias" className="rounded-lg border border-border bg-card p-4">
      <h3 id="titulo-dias" className="font-semibold text-foreground">
        Apuntados por día
      </h3>
      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_APUNTADOS }} />
          Apuntados: {formatNumber(totalLeads)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_CONFIRMADOS }} />
          De ellos, confirmaron: {formatNumber(totalConfirmados)}
        </span>
        <span>Día en que se apuntaron (últimos {dias.length} con datos)</span>
      </p>
      <div className="mt-3 h-56" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dias} margin={{ top: 4, right: 8, bottom: 0, left: -16 }} barGap={2}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
            <XAxis
              dataKey="fecha"
              tickFormatter={diaCorto}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
              minTickGap={16}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: 'hsl(var(--muted) / 0.5)' }}
              labelFormatter={(f) => diaCorto(String(f))}
              formatter={(v, nombre) => [formatNumber(Number(v)), nombre === 'leads' ? 'Apuntados' : 'Confirmaron']}
              contentStyle={{
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 8,
                fontSize: 12,
                color: 'hsl(var(--foreground))',
              }}
            />
            <Bar dataKey="leads" fill={COLOR_APUNTADOS} radius={[3, 3, 0, 0]} maxBarSize={28} />
            <Bar dataKey="confirmados" fill={COLOR_CONFIRMADOS} radius={[3, 3, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Apuntados y confirmados por día</caption>
        <thead>
          <tr>
            <th>Día</th>
            <th>Apuntados</th>
            <th>Confirmaron</th>
          </tr>
        </thead>
        <tbody>
          {dias.map((d) => (
            <tr key={d.fecha}>
              <td>{diaCorto(d.fecha)}</td>
              <td>{d.leads}</td>
              <td>{d.confirmados}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
