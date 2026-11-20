'use client'

import { useEffect, useRef, useState } from 'react'
import type { FeedbackSummary } from '@/lib/forms/feedback'

export interface RespuestaSinFicha {
  id: string
  form_id: string
  form_name: string
  created_at: string
  rating: number | null
  nps: number | null
  /** Email contestado en ESA versión del formulario; null si no lo llegó a pedir. */
  email: string | null
}

export interface FeedbackData {
  forms: {
    id: string
    name: string
    category: string
    status: string
    responses: number
    average: number | null
    nps: number | null
  }[]
  summary: FeedbackSummary
  /** Completadas sin `contact_id`: el hueco que antes no se veía. */
  sinFicha: {
    total: number
    /** Si la lectura falló, `total` no significa cero: la pantalla lo pinta como hueco. */
    error: string | null
    rows: RespuestaSinFicha[]
    truncated: boolean
    canAssign: boolean
  }
  days: number
  truncated?: boolean
}

export function useFeedback(tenant: string, days: string) {
  const [data, setData] = useState<FeedbackData | null>(null)
  const [error, setError] = useState('')
  const [recarga, setRecarga] = useState(0)
  const clave = useRef('')
  useEffect(() => {
    const ctl = new AbortController()
    // Solo se vacía al cambiar de subcuenta o de rango: una recarga (tras vincular, o «Reintentar») conserva lo que
    // hay en pantalla en vez de parpadear al estado de carga y perder la posición en la cola.
    const k = `${tenant}:${days}`
    if (clave.current !== k) {
      clave.current = k
      setData(null)
    }
    fetch(`/api/${tenant}/evergreen/forms/feedback?days=${days}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'No se pudo cargar el feedback')
        setData(j)
        setError('')
      })
      .catch((e: Error) => e.name !== 'AbortError' && setError(e.message))
    return () => ctl.abort()
  }, [tenant, days, recarga])
  return { data, error, recargar: () => setRecarga((n) => n + 1) }
}
