import { after, NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getTenantConfigWithFallback } from '@/lib/config'
import { isValidWebhookSecret } from '@/lib/webhooks/verifySecret'
import { normalizarMensajeGhl } from '@/lib/conversaciones/ingesta'
import { registrarMensaje } from '@/lib/conversaciones/persistir'
import { marcarEcoDeIA } from '@/lib/conversaciones/eco'
import { procesarMensajeEntrante } from '@/lib/conversaciones/orquestador'
import { depsReales } from '@/lib/conversaciones/deps-reales'

export const runtime = 'nodejs'
// after() hereda este tope: el agente puede encadenar resumen + respuesta de IA + envío por GHL (cada llamada de IA
// admite hasta 45 s). Con 10 s la plataforma mataba el proceso a medias, sin traspaso ni registro.
export const maxDuration = 60

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

  const normalizado = normalizarMensajeGhl(payload)
  if (!normalizado) return NextResponse.json({ ok: true, guardado: false, motivo: 'no es un mensaje guardable' })
  // El eco de un envío del agente de IA se guarda como mensaje de la IA, no como respuesta de una persona.
  const mensaje = await marcarEcoDeIA(sb, tenantRow.id as string, normalizado)

  const r = await registrarMensaje(sb, tenantRow.id as string, mensaje)
  if (!r.ok) {
    console.error('[ghl-mensajes] no se pudo guardar el mensaje:', r.error)
    return NextResponse.json({ error: 'No se pudo guardar el mensaje' }, { status: 500 })
  }

  // Un mensaje ENTRANTE NUEVO puede activar al agente de IA. Va en segundo plano para responder a GHL al
  // instante; el orquestador decide (apagado por defecto), es idempotente y deja auditoría de todo.
  if (r.nuevo && mensaje.direccion === 'entrante') {
    const tenantId = tenantRow.id as string
    after(async () => {
      try {
        const res = await procesarMensajeEntrante(
          sb,
          tenantId,
          r.conversationId,
          mensaje.externalId,
          await depsReales(tenantId)
        )
        if (res.accion === 'error') console.warn('[ghl-mensajes] agente:', res.error)
      } catch (e) {
        console.error('[ghl-mensajes] el agente falló:', e instanceof Error ? e.message : e)
      }
    })
  }
  return NextResponse.json({ ok: true, guardado: true, nuevo: r.nuevo })
}
