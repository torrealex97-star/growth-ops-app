'use client'

import { useEffect, useState } from 'react'
import type { FeedbackSummary } from '@/lib/forms/feedback'

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
  days: number
  truncated?: boolean
}

export function useFeedback(tenant: string, days: string) {
  const [data, setData] = useState<FeedbackData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const ctl = new AbortController()
    setData(null)
    fetch(`/api/${tenant}/evergreen/forms/feedback?days=${days}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'No se pudo cargar el feedback')
        setData(j)
        setError('')
      })
      .catch((e: Error) => e.name !== 'AbortError' && setError(e.message))
    return () => ctl.abort()
  }, [tenant, days])
  return { data, error }
}
