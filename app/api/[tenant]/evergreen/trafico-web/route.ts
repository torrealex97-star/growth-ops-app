import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requirePantalla } from '@/lib/auth/requirePantalla'
import { fetchAllRows } from '@/lib/supabase/paginate'
import { calcularTraficoWeb, type EventoTrafico } from '@/lib/analytics/trafico-web'

export const runtime = 'nodejs'

// GET /api/[tenant]/evergreen/trafico-web?from=YYYY-MM-DD&to=YYYY-MM-DD
// Devuelve el periodo pedido y el periodo anterior de la misma duración, para comparar.
// Service-role: la autorización es la de la pantalla (F02) y el tenant sale de la sesión.
const PANTALLA = '/marketing/adquisicion/trafico-web'
const EVENTOS = ['page_view', 'landing_view', 'lead', 'form_submit', 'appointment_booked', 'purchase']
const DIA_MS = 86_400_000
const MAX_DIAS = 366

const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))
const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requirePantalla(tenant, PANTALLA)
  if ('error' in session) return session.error

  const url = new URL(req.url)
  const to = url.searchParams.get('to') || ymd(Date.now())
  const from = url.searchParams.get('from') || ymd(Date.parse(`${to}T00:00:00Z`) - 29 * DIA_MS)
  if (!isIsoDate(from) || !isIsoDate(to)) {
    return NextResponse.json({ error: 'Las fechas deben ir en formato YYYY-MM-DD' }, { status: 400 })
  }
  if (from > to) {
    return NextResponse.json({ error: 'La fecha de inicio es posterior a la de fin' }, { status: 400 })
  }
  const dias = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DIA_MS) + 1
  if (dias > MAX_DIAS) {
    return NextResponse.json({ error: `El periodo no puede superar ${MAX_DIAS} días` }, { status: 400 })
  }
  const prevTo = ymd(Date.parse(`${from}T00:00:00Z`) - DIA_MS)
  const prevFrom = ymd(Date.parse(`${from}T00:00:00Z`) - dias * DIA_MS)

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const leer = (desde: string, hasta: string) =>
    fetchAllRows<EventoTrafico>(() =>
      sb
        .from('canonical_events')
        .select('visitor_id,session_id,event_name,occurred_at,url:properties->>url,referrer:properties->>referrer')
        .eq('tenant_id', session.tenantId)
        .in('event_name', EVENTOS)
        .gte('occurred_at', `${desde}T00:00:00Z`)
        .lte('occurred_at', `${hasta}T23:59:59.999Z`)
        .order('id')
    )
  const [actual, anterior] = await Promise.all([leer(from, to), leer(prevFrom, prevTo)])
  if (actual.error || anterior.error) {
    return NextResponse.json(
      { error: 'No se pudieron leer los eventos', requestId: session.requestId },
      { status: 500 }
    )
  }
  return NextResponse.json(
    {
      actual: calcularTraficoWeb(actual.rows),
      anterior: calcularTraficoWeb(anterior.rows),
      truncated: actual.truncated || anterior.truncated,
      periodo: { from, to, prevFrom, prevTo },
    },
    { headers: { 'Cache-Control': 'private, max-age=60' } }
  )
}
