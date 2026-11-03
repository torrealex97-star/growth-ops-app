import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getCarruselUser } from '@/lib/carruseles/auth'
import { estilosDe } from '@/lib/carruseles/estilos'
import { recomponerHistorias } from '@/lib/carruseles/recomponer'

export const runtime = 'nodejs'
export const maxDuration = 30

// POST { projectId, estilo? } → recompone las historias del proyecto con su especificación, sin IA (cambio de estilo
// instantáneo o tras subir material). Devuelve cuántas se actualizaron y cuántas son antiguas y no se pueden recomponer.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  if (!(await getCarruselUser())) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown; estilo?: unknown; plataforma?: unknown }
  if (typeof body.projectId !== 'string' || !body.projectId)
    return NextResponse.json({ error: 'Falta el proyecto' }, { status: 400 })
  const estilo =
    typeof body.estilo === 'string' && (estilosDe(true) as string[]).includes(body.estilo) ? body.estilo : undefined
  try {
    const plataforma = body.plataforma === 'tiktok' || body.plataforma === 'instagram' ? body.plataforma : undefined
    return NextResponse.json(await recomponerHistorias(t.tenantId, body.projectId, { estilo, plataforma }))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo recomponer' }, { status: 500 })
  }
}
