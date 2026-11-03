'use client'

import { useCallback, useEffect, useState } from 'react'
import { esClaveDeMes, mesVencido, mesesDisponibles } from '@/lib/commissions/meses'

// Mes elegido por el colaborador, COMPARTIDO entre sus pantallas durante la sesión (sessionStorage) para que un solo
// selector rija todo. Cada sesión nueva arranca SIEMPRE en el MES VENCIDO (el que está por cobrar): nunca se hereda
// una elección de otro día.
const clave = (tenant: string) => `colab-mes:${tenant}`

export function useMesColaborador(tenant: string): readonly [string, (ym: string) => void] {
  const [mes, setMesState] = useState<string>(() => mesVencido())

  useEffect(() => {
    try {
      const guardado = window.sessionStorage.getItem(clave(tenant))
      if (esClaveDeMes(guardado) && mesesDisponibles().includes(guardado)) setMesState(guardado)
    } catch {
      // sin sessionStorage (modo privado, bloqueado): se queda el mes vencido por defecto
    }
  }, [tenant])

  const setMes = useCallback(
    (ym: string) => {
      if (!esClaveDeMes(ym)) return
      setMesState(ym)
      try {
        window.sessionStorage.setItem(clave(tenant), ym)
      } catch {
        // idem: la elección vale solo para esta pantalla
      }
    },
    [tenant]
  )

  return [mes, setMes] as const
}
