import { NextRequest, NextResponse } from 'next/server'
import { requirePantalla } from '@/lib/auth/requirePantalla'
import { sincronizarComisionesColdCalling } from '@/lib/cold-calling/comisiones'
import { leerAjustes } from '@/lib/cold-calling/config'
import { ESTADOS } from '@/lib/cold-calling/estados'
import { reasignarLead } from '@/lib/cold-calling/operaciones'
import { callersDelTenant, panelManager } from '@/lib/cold-calling/panel'
import {
  ErrorColdCalling,
  esUuid,
  puedeConfigurarColdCalling,
  puedeGestionarColdCalling,
} from '@/lib/cold-calling/policy'
import { pedirMas } from '@/lib/cold-calling/reparto'
import { leerJson, resolverLanzamiento, responderError, servicio } from '@/lib/cold-calling/servidor'
import { limitar } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

const NO_GESTIONA = 'Solo quien gestiona el cold calling puede ver el panel del equipo'

// GET /api/[tenant]/evergreen/cold-calling/manager[?launch=<id>]
//
// Panel del equipo: actividad por cold caller, leads que necesitan atención, últimas acciones y
// ventas que cuentan con su importe. Solo lectura.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requirePantalla(tenant, '/cold-calling')
  if ('error' in auth) return auth.error
  if (!puedeGestionarColdCalling(auth)) return NextResponse.json({ error: NO_GESTIONA }, { status: 403 })

  const sb = servicio()
  try {
    const [{ lanzamientos, launch }, ajustes] = await Promise.all([
      resolverLanzamiento(sb, auth.tenantId, req.nextUrl.searchParams.get('launch')),
      leerAjustes(sb, auth.tenantId),
    ])
    const comun = { lanzamientos, launch, ajustes, puedeConfigurar: puedeConfigurarColdCalling(auth), estados: ESTADOS }
    if (!launch) return NextResponse.json({ ...comun, callers: await callersDelTenant(sb, auth.tenantId) })
    return NextResponse.json({ ...comun, ...(await panelManager(sb, auth.tenantId, { launch, ajustes })) })
  } catch (e) {
    return responderError(e, 'manager')
  }
}

type Cuerpo = {
  accion?: string
  id?: unknown
  callerId?: unknown
  motivo?: unknown
  cantidad?: unknown
  launch?: unknown
}

// POST /api/[tenant]/evergreen/cold-calling/manager
//   { accion: 'repartir', callerId, cantidad?, launch? } → entrega una tanda a una cold caller
//   { accion: 'reasignar', id, callerId, motivo }        → pasa un lead a otra, con motivo
//   { accion: 'sincronizar' }                            → recalcula las comisiones en el ledger
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requirePantalla(tenant, '/cold-calling')
  if ('error' in auth) return auth.error
  if (!puedeGestionarColdCalling(auth)) return NextResponse.json({ error: NO_GESTIONA }, { status: 403 })
  const body = await leerJson<Cuerpo>(req)
  if (!body) return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })

  const sb = servicio()
  try {
    if (body.accion === 'sincronizar') {
      const lim = limitar(`cold-calling:sync:${auth.tenantId}`, 4, 60_000)
      if (!lim.ok) throw new ErrorColdCalling('Se acaba de sincronizar. Espera un momento.', 409)
      return NextResponse.json({ ok: true, ...(await sincronizarComisionesColdCalling(sb, auth.tenantId)) })
    }

    if (!esUuid(body.callerId)) throw new ErrorColdCalling('Elige una cold caller')
    const activas = new Set((await callersDelTenant(sb, auth.tenantId)).filter((c) => c.activa).map((c) => c.id))

    if (body.accion === 'reasignar') {
      if (!esUuid(body.id)) throw new ErrorColdCalling('Falta el lead')
      const lead = await reasignarLead(sb, auth.tenantId, {
        assignmentId: body.id,
        nuevoCallerId: body.callerId,
        actorId: auth.userId,
        motivo: typeof body.motivo === 'string' ? body.motivo : '',
        callersValidos: activas,
      })
      return NextResponse.json({ ok: true, lead: { id: lead.id, callerId: lead.caller_id } })
    }

    if (body.accion === 'repartir') {
      if (!activas.has(body.callerId)) {
        throw new ErrorColdCalling('La persona elegida no es una cold caller activa de esta subcuenta')
      }
      const [{ launch }, ajustes] = await Promise.all([
        resolverLanzamiento(sb, auth.tenantId, typeof body.launch === 'string' ? body.launch : null),
        leerAjustes(sb, auth.tenantId),
      ])
      if (!launch) throw new ErrorColdCalling('No hay ningún lanzamiento abierto del que repartir leads')
      const cantidad = typeof body.cantidad === 'number' && Number.isInteger(body.cantidad) ? body.cantidad : undefined
      const r = await pedirMas(sb, auth.tenantId, {
        launch,
        callerId: body.callerId,
        actorId: auth.userId,
        ajustes,
        forzar: true,
        cantidad,
      })
      return NextResponse.json({ ok: true, ...r })
    }

    return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 })
  } catch (e) {
    return responderError(e, 'manager-accion')
  }
}
