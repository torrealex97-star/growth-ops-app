'use client'

import { useParams } from 'next/navigation'
import { ResponsesTable } from '@/components/forms/ResponsesTable'

export default function RespuestasPage() {
  const { id } = useParams<{ id: string }>()
  return <ResponsesTable formId={id} />
}
