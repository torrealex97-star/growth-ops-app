'use client'

import { Label } from '@/components/ui/label'

// Último día del mes YYYY-MM como YYYY-MM-DD.
const finDeMes = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
}

/** Rango de MESES para el preset «custom»: guarda día 1 del primer mes y último día del último, que es lo que entiende getPeriodRange. */
export function MonthRangeInputs({
  from,
  to,
  onFromChange,
  onToChange,
}: {
  from: string
  to: string
  onFromChange: (v: string) => void
  onToChange: (v: string) => void
}) {
  const campo = 'h-9 rounded-md border border-border bg-muted px-3 text-sm text-foreground'
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Desde (mes)</Label>
        <input
          type="month"
          className={campo}
          value={from.slice(0, 7)}
          onChange={(e) => onFromChange(e.target.value ? `${e.target.value}-01` : '')}
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Hasta (mes)</Label>
        <input
          type="month"
          className={campo}
          value={to.slice(0, 7)}
          onChange={(e) => onToChange(e.target.value ? finDeMes(e.target.value) : '')}
        />
      </div>
    </div>
  )
}
