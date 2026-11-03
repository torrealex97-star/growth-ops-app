'use client'

import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  etapaDeMes,
  etiquetaMesLarga,
  mesActual,
  mesVencido,
  mesesDisponibles,
  sumarMeses,
} from '@/lib/commissions/meses'

// SELECTOR ÚNICO DE MES del colaborador: un solo control arriba que rige comisiones, factura y embudo.
// Por defecto el MES VENCIDO (el que acaba de cerrar: es el que está por cobrar y el que se factura).
// Flechas para ir mes a mes, desplegable para los 12 anteriores y dos atajos: «Mes vencido» y «Mes actual».

const sufijo = (ym: string) => {
  const e = etapaDeMes(ym)
  return e === 'vencido' ? ' · mes vencido' : e === 'actual' ? ' · mes actual' : ''
}

export function SelectorMes({
  value,
  onChange,
  className = '',
}: {
  value: string
  onChange: (ym: string) => void
  className?: string
}) {
  const ahora = new Date()
  const opciones = mesesDisponibles(ahora, 12)
  const vencido = mesVencido(ahora)
  const actual = mesActual(ahora)
  const masAntiguo = opciones[opciones.length - 1]
  // Si el valor viniera de fuera de la ventana, se muestra igualmente en la lista.
  const lista = opciones.includes(value) ? opciones : [value, ...opciones]

  return (
    <div role="group" aria-label="Mes que se muestra" className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9"
          aria-label="Mes anterior"
          disabled={value <= masAntiguo}
          onClick={() => onChange(sumarMeses(value, -1))}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="h-9 min-w-[230px] bg-background" aria-label="Elegir mes">
            <CalendarDays className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {lista.map((m) => (
              <SelectItem key={m} value={m}>
                {etiquetaMesLarga(m)}
                {sufijo(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-9 w-9"
          aria-label="Mes siguiente"
          disabled={value >= actual}
          onClick={() => onChange(sumarMeses(value, 1))}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Atajos">
        {[
          { ym: vencido, texto: 'Mes vencido' },
          { ym: actual, texto: 'Mes actual' },
        ].map(({ ym, texto }) => (
          <button
            key={texto}
            type="button"
            aria-pressed={value === ym}
            onClick={() => onChange(ym)}
            className={`h-8 rounded-full border px-3 text-xs font-medium transition-colors ${
              value === ym
                ? 'border-brand-500 bg-brand-500 text-white'
                : 'border-border bg-transparent text-muted-foreground hover:border-brand-500/50 hover:text-foreground'
            }`}
          >
            {texto}
          </button>
        ))}
      </div>
    </div>
  )
}
