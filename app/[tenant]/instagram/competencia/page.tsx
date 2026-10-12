import { redirect } from 'next/navigation'

export default async function CompetenciaPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  redirect(`/${tenant}/instagram/radar?view=competidores`)
}
