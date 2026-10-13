import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { nombresPreviosPorCampana } from '@/lib/campaigns/nombres-previos'

export const runtime = 'nodejs'

// Nombres previos de campaña detectados en los utm históricos de los contactos ya asignados
// (derivado, readonly: no persiste nada). El cliente lo pinta como badge "renombrada" en la
// ficha de campaña para que un rename de Meta no parezca pérdida de atribución.
function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params
    const t = await requireTenant(tenant)
    if ('error' in t) return t.error
    const sb = svc()
    // `Record<campaignId, { previos, conteo }>`: el cliente casado por c.id en O(1).
    const byCampaign = await nombresPreviosPorCampana(sb, t.tenantId)
    return NextResponse.json({ byCampaign })
  } catch (err) {
    console.error('[api/meta/campaigns/nombres-previos GET]', err)
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
