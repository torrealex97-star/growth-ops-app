import { NextRequest, NextResponse } from 'next/server'
import { requirePantalla } from '@/lib/auth/requirePantalla'
import { guardarAjustes } from '@/lib/cold-calling/config'
import { puedeConfigurarColdCalling } from '@/lib/cold-calling/policy'
import { leerJson, responderError, servicio } from '@/lib/cold-calling/servidor'

export const runtime = 'nodejs'

// PUT /api/[tenant]/evergreen/cold-calling/config
//
// Guarda los ajustes de cold calling de la subcuenta. Los tramos son dinero: solo quien administra
// la subcuenta o un director (el manager de cold calling los ve, no los cambia). Cambiarlos afecta
// a las comisiones aún NO liquidadas en la siguiente sincronización; las ya pagadas no se tocan.
// La lectura va con el panel del equipo (GET …/cold-calling/manager).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requirePantalla(tenant, '/cold-calling')
  if ('error' in auth) return auth.error
  if (!puedeConfigurarColdCalling(auth)) {
    return NextResponse.json(
      { error: 'Solo quien administra la subcuenta o un director puede cambiar los tramos de comisión' },
      { status: 403 }
    )
  }
  const body = await leerJson<Record<string, unknown>>(req)
  if (!body) return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  try {
    return NextResponse.json({ ok: true, ajustes: await guardarAjustes(servicio(), auth.tenantId, auth.userId, body) })
  } catch (e) {
    return responderError(e, 'config')
  }
}
