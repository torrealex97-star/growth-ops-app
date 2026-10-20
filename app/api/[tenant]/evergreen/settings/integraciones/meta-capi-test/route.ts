import { NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { getTenantConfig } from '@/lib/config'
import { META_API_VERSION } from '@/lib/meta/api-version'
import { construirEventoCapi, enviarEventosCapi, eventIdDeterminista } from '@/lib/meta/capi'

export const runtime = 'nodejs'

// POST /api/[tenant]/evergreen/settings/integraciones/meta-capi-test   { "testEventCode": "TEST12345" }
//
// ENVÍO DE PRUEBA a la Conversions API. Exige el código TEST del Administrador de eventos de Meta:
// con él, Meta muestra el evento solo en la pestaña «Probar eventos» y NO lo cuenta en las métricas
// de producción. Sin código, esta ruta se niega — no existe forma de usarla para mandar datos reales.
// Funciona aunque META_CAPI_ENABLED esté apagado: sirve justo para verificar antes de activarlo.
// Solo admin/director, con el tenant de la sesión.
export async function POST(request: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!['admin', 'director'].includes(auth.role || '')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as { testEventCode?: unknown } | null
  const code = typeof body?.testEventCode === 'string' ? body.testEventCode.trim() : ''
  if (!/^TEST[A-Za-z0-9]{1,30}$/.test(code)) {
    return NextResponse.json(
      { error: 'Falta el código de prueba (empieza por TEST) del Administrador de eventos › Probar eventos.' },
      { status: 400 }
    )
  }

  const cfg = await getTenantConfig(auth.tenantId)
  const pixelId = (cfg.META_PIXEL_ID ?? '').trim()
  const accessToken = (cfg.META_ACCESS_TOKEN ?? '').trim()
  if (!/^\d{8,20}$/.test(pixelId)) {
    return NextResponse.json({ error: 'Falta el ID del Pixel en la integración de Meta.' }, { status: 400 })
  }
  if (!accessToken) {
    return NextResponse.json({ error: 'Falta el Access Token en la integración de Meta.' }, { status: 400 })
  }

  // Datos sintéticos: nada de personas reales en una prueba.
  const evento = construirEventoCapi({
    eventName: 'Lead',
    eventId: eventIdDeterminista('prueba', crypto.randomUUID()),
    eventTime: new Date(),
    contacto: { email: 'prueba@example.com', externalId: 'prueba' },
  })
  const r = await enviarEventosCapi(
    { pixelId, accessToken, apiVersion: (cfg.META_API_VERSION ?? '').trim() || META_API_VERSION },
    [evento],
    { testEventCode: code }
  )
  if (!r.ok) {
    return NextResponse.json({ ok: false, error: r.error, fbtraceId: r.fbtraceId }, { status: 502 })
  }
  return NextResponse.json({ ok: true, eventosRecibidos: r.eventosRecibidos, fbtraceId: r.fbtraceId })
}
