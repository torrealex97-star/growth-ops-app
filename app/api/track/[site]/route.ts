import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  MinuteRateLimiter,
  classifyBot,
  deriveChannel,
  hashIp,
  isValidEventName,
  originAllowed,
} from '@/lib/tracking/ingest'
import { normalizarEventoRaw, type TrackBody } from '@/lib/tracking/normalizar'

export const runtime = 'nodejs'

// Rate limiter en memoria del proceso (best-effort; ver comentario en la clase).
const limiter = new MinuteRateLimiter()

// Los eventos del brief de captación. Cualquier otro nombre se rechaza: un canal abierto de
// escritura con nombres libres sería la puerta a basura en canonical_events (y las agregaciones
// del funnel asumen esta lista).
const ALLOWED_EVENTS = new Set([
  'page_view',
  'landing_view',
  'cta_view',
  'cta_click',
  'form_start',
  'form_submit',
  'lead',
  'appointment_booked',
  'appointment_attended',
  'purchase',
  // VSL (el dashboard detallado de VSL usa los mismos; aquí solo cuentan como etapas del funnel)
  'vsl_view',
  'vsl_progress',
  'vsl_complete',
])

const MAX_PAYLOAD_BYTES = 8 * 1024

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
function clientIp(req: NextRequest): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
}

/**
 * INGESTA DEL PIXEL FIRST-PARTY (Fase C). Pública: la llaman navegadores sin sesión, así que
 * NO usa requireTenant (no hay cookie) ni el secreto TRACKING_INGEST_KEY (un secreto no puede
 * vivir en un script servido al navegador). La autenticación es la public_key del site:
 * identifica site+subcuenta y SOLO concede escritura acotada de eventos — nunca lectura.
 *
 * Flujo: resolve site → valida origin+rate limit+evento → guarda RAW tal como llegó →
 * normaliza a canónico (visitor/session/touchpoint get-or-create con claves por subcuenta).
 * Un fallo de normalización NO pierde el raw (§8 del mapa de tracking): queda con
 * processing_status='received' para replay.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ site: string }> }) {
  const { site: publicKey } = await params
  if (!/^gop_pk_[A-Za-z0-9_-]{32,64}$/.test(publicKey)) {
    return NextResponse.json({ error: 'Clave inválida' }, { status: 400 })
  }

  const origin = request.headers.get('origin')
  const userAgent = request.headers.get('user-agent')
  const ip = clientIp(request)

  // Cuerpo pequeño a propósito: un pixel no manda ni 1KB. El tamaño es la primera barrera de abuso.
  const rawBody = await request.text().catch(() => null)
  if (!rawBody || rawBody.length > MAX_PAYLOAD_BYTES) {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 413 })
  }
  let body: TrackBody
  try {
    body = JSON.parse(rawBody) as TrackBody
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const eventName = (body.event ?? '').trim()
  if (!isValidEventName(eventName) || !ALLOWED_EVENTS.has(eventName)) {
    return NextResponse.json({ error: 'Evento desconocido' }, { status: 422 })
  }

  const sb = serviceClient()
  if (!sb)
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY no configurada en este entorno' }, { status: 500 })

  // 1) Resolver site+tenant por la clave pública (única global por diseño de la migración).
  // La subcuenta dueña del site debe estar ACTIVA: una subcuenta archivada/suspendida no sigue
  // recogiendo eventos (su pixel deja de responder con 409, igual que un site con tracking off).
  const { data: site } = await sb
    .from('tracking_sites')
    .select(
      'id, tenant_id, slug, allowed_origins, allow_localhost, tracking_enabled, rate_limit_per_minute, tenants!inner(status)'
    )
    .eq('public_key', publicKey)
    .eq('tenants.status', 'active')
    .maybeSingle()
  if (!site) return NextResponse.json({ error: 'Site desconocido' }, { status: 404 })
  if (!site.tracking_enabled) return NextResponse.json({ error: 'Tracking desactivado' }, { status: 409 })

  // 2) Origin allowlist (el vacío = ninguno autorizado, por diseño de la migración).
  if (!originAllowed(origin, site.allowed_origins ?? [], site.allow_localhost)) {
    return NextResponse.json({ error: 'Origen no autorizado' }, { status: 403 })
  }

  // 3) Rate limit por clave (techo por proceso; ver MinuteRateLimiter).
  if (!limiter.allow(publicKey, site.rate_limit_per_minute ?? 600)) {
    return NextResponse.json({ error: 'Límite de eventos superado' }, { status: 429 })
  }

  const bot = classifyBot(userAgent)
  const receivedAt = new Date()
  const tenantId: string = site.tenant_id

  // 4) RAW tal como llegó (idempotente por event_id del navegador cuando viene).
  const eventId = (body.event_id ?? '').trim().slice(0, 200) || null
  const { data: rawRow, error: rawError } = await sb
    .from('raw_events')
    .insert({
      tenant_id: tenantId,
      site_id: site.id,
      source: 'pixel',
      source_event_id: eventId,
      source_schema_version: '1.0',
      normalizer_version: '1.0',
      payload: body as unknown as Record<string, unknown>,
      payload_bytes: rawBody.length,
      processing_status: 'received',
      request_origin: origin,
      user_agent: userAgent,
      ip_hash: hashIp(ip, process.env.TRACKING_IP_SALT),
      bot_classification: bot,
      correlation_id: crypto.randomUUID(),
      received_at: receivedAt.toISOString(),
    })
    .select('id')
    .single()
  // Duplicado por event_id: la ingesta es idempotente; el navegador reintenta y no duplica.
  if (rawError) {
    if (rawError.code === '23505') {
      return NextResponse.json({ accepted: true, duplicate: true }, { status: 200 })
    }
    return NextResponse.json({ error: 'No se pudo registrar el evento' }, { status: 500 })
  }

  const resultado = await normalizarEventoRaw(sb, {
    tenantId,
    siteId: site.id,
    rawId: rawRow.id,
    body,
    eventName,
    eventId,
    receivedAt,
    capi: { clientIp: ip, userAgent, bot: bot === 'likely_bot' },
  })
  return NextResponse.json(resultado.json, { status: resultado.status })
}

// OPTIONS para que el navegador permita el POST cross-origin desde los dominios autorizados.
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  })
}
