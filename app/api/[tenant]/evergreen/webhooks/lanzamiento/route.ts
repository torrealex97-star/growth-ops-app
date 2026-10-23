import { NextRequest } from 'next/server'
import { procesarWebhookLanzamiento } from '@/lib/launch/webhook'

export const runtime = 'nodejs'
export const maxDuration = 10

// WEBHOOK ENTRANTE DEL LANZAMIENTO (GHL).
//
// Tres acciones de GHL apuntan aquí con `?evento=` distinto en cada URL:
//   · sin ?evento (o ?evento=alta)          → alta del lead (registro + UTMs)
//   · ?evento=encuesta                      → respuestas del formulario previo
//   · ?evento=confirmacion|desconfirmacion  → botón "Sí, confirmo" del móvil
// Todo el esqueleto vive en lib/launch/webhook.ts. El secreto se escribe al crear el webhook en GHL
// (Custom Webhook → Header `x-ghl-secret`) y se guarda en Integraciones (clave
// LANZAMIENTO_WEBHOOK_SECRET, por subcuenta).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  return procesarWebhookLanzamiento({ req, params })
}
