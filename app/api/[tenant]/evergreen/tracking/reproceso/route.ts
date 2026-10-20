import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requirePantalla } from '@/lib/auth/requirePantalla'
import { isValidEventName } from '@/lib/tracking/ingest'
import { normalizarEventoRaw, type TrackBody } from '@/lib/tracking/normalizar'

export const runtime = 'nodejs'

// POST /api/[tenant]/evergreen/tracking/reproceso   { "limit": 100 }
//
// Reprocesa eventos RAW del pixel que se quedaron en `received` (fallo de normalización a mitad,
// p. ej. la base caída un momento). Manual a propósito: sin cron no añade carga ni se duplica con los
// de Vercel (docs/FREE_TIER_OPERATIONS.md). Idempotente: usa el mismo código que la ingesta
// (normalizarEventoRaw) y el canónico se upserta por (tenant_id, source, source_event_id), así que
// repetirlo no duplica nada. Lotes pequeños y acotados para no pasar del presupuesto de la Function.
const PANTALLA = '/settings/data-health'
const LIMITE_POR_DEFECTO = 100
const LIMITE_MAXIMO = 200

type RawPendiente = {
  id: string
  site_id: string | null
  received_at: string
  payload: TrackBody | null
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requirePantalla(tenant, PANTALLA)
  if ('error' in session) return session.error

  const body = (await req.json().catch(() => ({}))) as { limit?: unknown }
  const pedido = body.limit === undefined ? LIMITE_POR_DEFECTO : Number(body.limit)
  if (!Number.isInteger(pedido) || pedido < 1 || pedido > LIMITE_MAXIMO) {
    return NextResponse.json({ error: `limit debe ser un entero entre 1 y ${LIMITE_MAXIMO}` }, { status: 400 })
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Índice parcial raw_events_pendientes_idx (tenant_id, received_at) WHERE processing_status='received'.
  const { data, error } = await sb
    .from('raw_events')
    .select('id,site_id,received_at,payload')
    .eq('tenant_id', session.tenantId)
    .eq('source', 'pixel')
    .eq('processing_status', 'received')
    .order('received_at', { ascending: true })
    .limit(pedido)
  if (error) {
    return NextResponse.json(
      { error: 'No se pudieron leer los eventos pendientes', requestId: session.requestId },
      { status: 500 }
    )
  }

  const filas = (data ?? []) as RawPendiente[]
  let normalizados = 0
  let sinResolver = 0
  let invalidos = 0
  for (const fila of filas) {
    const payload = fila.payload
    const eventName = (payload?.event ?? '').trim()
    if (!payload || !fila.site_id || !isValidEventName(eventName)) {
      invalidos += 1
      continue
    }
    const eventId = (payload.event_id ?? '').trim().slice(0, 200) || null
    try {
      const r = await normalizarEventoRaw(sb, {
        tenantId: session.tenantId,
        siteId: fila.site_id,
        rawId: fila.id,
        body: payload,
        eventName,
        eventId,
        receivedAt: new Date(fila.received_at),
      })
      if (r.json.accepted === true) normalizados += 1
      else sinResolver += 1
    } catch {
      sinResolver += 1
    }
  }

  return NextResponse.json({
    revisados: filas.length,
    normalizados,
    sinResolver,
    invalidos,
    // Si el lote vino lleno, probablemente quedan más: se vuelve a llamar hasta que revisados < limit.
    quedanMas: filas.length === pedido,
  })
}
