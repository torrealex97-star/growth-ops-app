import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getTenantConfigWithFallback } from '@/lib/config'
import { isValidWebhookSecret } from '@/lib/webhooks/verifySecret'
import { normalizarMensajeGhl } from '@/lib/conversaciones/ingesta'
import { registrarMensaje } from '@/lib/conversaciones/persistir'

export const runtime = 'nodejs'
export const maxDuration = 10

// WEBHOOK DE MENSAJES DE GHL (InboundMessage / OutboundMessage) → bandeja de Conversaciones.
//
// Mismo secreto y misma cabecera que el webhook de citas (`x-ghl-secret`, GHL_WEBHOOK_SECRET por subcuenta):
// se configura con una acción «Custom Webhook» de un workflow de GHL. Subcuenta inexistente y secreto
// incorrecto responden IGUAL (401) para no poder enumerar subcuentas.
//
// Responde 200 también cuando el cuerpo no es un mensaje guardable (no hay nada que reintentar) y 500 solo si
// fallamos nosotros, para que GHL reintente: la ingesta es idempotente por id de mensaje.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: tenantRow } = await sb
    .from('tenants')
    .select('id, status')
    .eq('slug', tenant)
    .eq('status', 'active')
    .maybeSingle()
  if (!tenantRow) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cfg = await getTenantConfigWithFallback(tenantRow.id as string, true)
  const esperado = cfg.GHL_WEBHOOK_SECRET || process.env.GHL_WEBHOOK_SECRET
  if (!isValidWebhookSecret(req.headers.get('x-ghl-secret'), esperado)) {
    console.warn(`[ghl-mensajes] 401 en "${tenant}": secreto ausente o distinto`)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const crudo = await req.text()
  if (crudo.length > 200_000) return NextResponse.json({ error: 'Cuerpo demasiado grande' }, { status: 413 })
  let payload: unknown
  try {
    payload = JSON.parse(crudo)
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const mensaje = normalizarMensajeGhl(payload)
  if (!mensaje) return NextResponse.json({ ok: true, guardado: false, motivo: 'no es un mensaje guardable' })

  const r = await registrarMensaje(sb, tenantRow.id as string, mensaje)
  if (!r.ok) {
    console.error('[ghl-mensajes] no se pudo guardar el mensaje:', r.error)
    return NextResponse.json({ error: 'No se pudo guardar el mensaje' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, guardado: true, nuevo: r.nuevo })
}
