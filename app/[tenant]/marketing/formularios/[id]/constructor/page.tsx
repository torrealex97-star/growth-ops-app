'use client'

import { useParams } from 'next/navigation'
import { useTenant } from '@/lib/tenant-context'
import { Builder } from '@/components/forms/builder/Builder'

export default function ConstructorPage() {
  const tenant = useTenant()
  const { id } = useParams<{ id: string }>()
  return <Builder tenant={tenant} formId={id} />
}
