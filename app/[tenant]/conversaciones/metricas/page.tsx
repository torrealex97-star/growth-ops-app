import { redirect } from 'next/navigation'

// Ruta antigua: todo vive ahora en una sola pantalla de Conversaciones.
export default async function MetricasRedirect({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  redirect(`/${tenant}/conversaciones?tab=metricas`)
}
