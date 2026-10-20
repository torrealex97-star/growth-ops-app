import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requirePantalla } from '@/lib/auth/requirePantalla'
import { fetchAllRows } from '@/lib/supabase/paginate'
import {
  PASOS_POR_DEFECTO,
  VENTANA_HORAS_POR_DEFECTO,
  calcularFunnelEventos,
  type EventoFila,
} from '@/lib/analytics/funnel-eventos'

export const runtime = 'nodejs'

// GET /api/[tenant]/evergreen/funnel-eventos?from=YYYY-MM-DD&to=YYYY-MM-DD&ventana=72
//
// Service-role (para que el recuento no cambie según el rol que mire), así que la autorización es la
// de la pantalla que sirve los datos (mismo criterio que /funnels, auditoría F02) y el tenant sale de
// la sesión validada y se estampa en la consulta: nunca de un parámetro.
const PANTALLA = '/marketing/adquisicion/funnel-eventos'
const MAX_VENTANA_HORAS = 24 * 30

const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requirePantalla(tenant, PANTALLA)
  if ('error' in session) return session.error

  const url = new URL(req.url)
  const to = url.searchParams.get('to') || new Date().toISOString().slice(0, 10)
  const fromDefault = new Date(`${to}T00:00:00Z`)
  fromDefault.setUTCDate(fromDefault.getUTCDate() - 29)
  const from = url.searchParams.get('from') || fromDefault.toISOString().slice(0, 10)
  if (!isIsoDate(from) || !isIsoDate(to)) {
    return NextResponse.json({ error: 'Las fechas deben ir en formato YYYY-MM-DD' }, { status: 400 })
  }
  if (from > to) {
    return NextResponse.json({ error: 'La fecha de inicio es posterior a la de fin' }, { status: 400 })
  }
  const ventanaParam = Number(url.searchParams.get('ventana') ?? VENTANA_HORAS_POR_DEFECTO)
  if (!Number.isFinite(ventanaParam) || ventanaParam < 1 || ventanaParam > MAX_VENTANA_HORAS) {
    return NextResponse.json({ error: `La ventana debe estar entre 1 y ${MAX_VENTANA_HORAS} horas` }, { status: 400 })
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const nombres = [...new Set(PASOS_POR_DEFECTO.flatMap((p) => p.eventos))]

  // Usa el índice (tenant_id, event_name, occurred_at). Solo 4 columnas: nada de properties.
  const { rows, error, truncated } = await fetchAllRows<EventoFila>(() =>
    sb
      .from('canonical_events')
      .select('visitor_id,contact_id,event_name,occurred_at')
      .eq('tenant_id', session.tenantId)
      .in('event_name', nombres)
      .gte('occurred_at', `${from}T00:00:00Z`)
      .lte('occurred_at', `${to}T23:59:59.999Z`)
      .order('id')
  )
  if (error) {
    return NextResponse.json(
      { error: 'No se pudieron leer los eventos', requestId: session.requestId },
      { status: 500 }
    )
  }
  // Un funnel con eventos cortados daría conversiones falsas: se avisa, no se disimula.
  const resultado = calcularFunnelEventos(rows, PASOS_POR_DEFECTO, { ventanaHoras: ventanaParam })
  return NextResponse.json(
    { ...resultado, truncated, eventosLeidos: rows.length, from, to, ventanaHoras: ventanaParam },
    { headers: { 'Cache-Control': 'private, max-age=60' } }
  )
}
