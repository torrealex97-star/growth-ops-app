import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requirePantalla } from '@/lib/auth/requirePantalla'
import { getTenantConfigWithFallback } from '@/lib/config'
import { CABECERA_SECRETO, CLAVE_SECRETO, EVENTOS_WEBHOOK, FUENTE_EVENTOS, rutaWebhook } from '@/lib/launch/conexion'
import { puedeGestionarLanzamiento } from '@/lib/launch/permisos'
import { eventosPorFuente } from '@/lib/webhooks/entrantes'

export const runtime = 'nodejs'

// GET /api/[tenant]/evergreen/lanzamiento/conexion
//
// Lo que hace falta para conectar GHL, servido a la pantalla de Lanzamientos: las direcciones del
// webhook ya montadas (una por evento), si el secreto está guardado y cuándo llegó el último evento.
// SOLO LECTURA y sin secretos: del secreto se dice si existe, nunca su valor ni su longitud. Guardarlo
// o cambiarlo sigue siendo cosa de Integraciones (quien administra la subcuenta).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requirePantalla(tenant, '/lanzamiento')
  if ('error' in auth) return auth.error

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Dos lecturas independientes: si una falla, la otra se sigue enseñando y la fallida queda como
  // "no se pudo comprobar" (null), no como "sin configurar" ni "nunca ha llegado nada".
  let secretoConfigurado: boolean | null = null
  try {
    const cfg = await getTenantConfigWithFallback(auth.tenantId)
    secretoConfigurado = Boolean(cfg[CLAVE_SECRETO])
  } catch (e) {
    console.error('[lanzamiento/conexion] estado del secreto:', e instanceof Error ? e.message : e)
  }

  let ultimoEvento: string | null = null
  let ultimoRechazo: string | null = null
  let eventosLeidos = true
  const { data, error } = await sb
    .from('raw_events')
    .select('source, received_at, processing_status')
    .eq('tenant_id', auth.tenantId)
    .eq('source', FUENTE_EVENTOS)
    .order('received_at', { ascending: false })
    .limit(30)
  if (error) {
    eventosLeidos = false
    console.error('[lanzamiento/conexion] últimos eventos:', error.message)
  } else {
    const r = eventosPorFuente((data ?? []) as Parameters<typeof eventosPorFuente>[0])[FUENTE_EVENTOS]
    ultimoEvento = r?.ultimo_valido?.fecha ?? null
    ultimoRechazo = r?.ultimo_rechazo?.fecha ?? null
  }

  return NextResponse.json({
    cabecera: CABECERA_SECRETO,
    eventos: EVENTOS_WEBHOOK.map((e) => ({ ...e, ruta: rutaWebhook(tenant, e) })),
    secretoConfigurado,
    eventosLeidos,
    ultimoEvento,
    ultimoRechazo,
    puedeConfigurar: puedeGestionarLanzamiento(auth),
  })
}
