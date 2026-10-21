'use client'

import { useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'

export default function FormularioIndexPage() {
  const tenant = useTenant()
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  useEffect(() => {
    router.replace(`/${tenant}/marketing/formularios/${id}/constructor`)
  }, [tenant, id, router])
  return null
}
