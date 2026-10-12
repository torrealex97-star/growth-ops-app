import { ContentRadarWorkspace } from '@/components/social/ContentRadarWorkspace'

export default async function RadarPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams
  return <ContentRadarWorkspace initialView={view === 'produccion' ? 'produccion' : 'oportunidades'} />
}
