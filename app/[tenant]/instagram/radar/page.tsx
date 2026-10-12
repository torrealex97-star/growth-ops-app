import { ContentRadarWorkspace, type ContentRadarView } from '@/components/social/ContentRadarWorkspace'

const RADAR_VIEWS = new Set<ContentRadarView>(['oportunidades', 'competidores', 'produccion'])

export default async function RadarPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams
  const initialView = RADAR_VIEWS.has(view as ContentRadarView) ? (view as ContentRadarView) : 'oportunidades'
  return <ContentRadarWorkspace initialView={initialView} />
}
