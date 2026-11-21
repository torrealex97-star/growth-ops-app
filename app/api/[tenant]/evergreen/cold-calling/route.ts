import { NextRequest, NextResponse } from 'next/server'
import { requirePantalla } from '@/lib/auth/requirePantalla'
import { leerAjustes } from '@/lib/cold-calling/config'
import { ESTADOS } from '@/lib/cold-calling/estados'
import { actualizarLead } from '@/lib/cold-calling/operaciones'
import { callersDelTenant, panelCaller } from '@/lib/cold-calling/panel'
import { ErrorColdCalling, esCaller, esUuid, puedeGestionarColdCalling } from '@/lib/cold-calling/policy'
import { pedirMas } from '@/lib/cold-calling/reparto'
import { leerJson, resolverLanzamiento, responderError, servicio } from '@/lib/cold-calling/servidor'
import { limitar } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

// GET /api/[tenant]/evergreen/cold-calling[?launch=<id>][&como=<userId>]
//
// La lista de una cold caller: sus leads, sus números, su dinero y el ranking del equipo. Ella ve la
// suya. Un gestor puede abrir la de cualquiera con `?como=` — en SOLO LECTURA y solo si esa persona
// es una cold caller de ESTA subcuenta (en el origen `?como=` aceptaba cualquier id).
// El GET no escribe nada.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requirePantalla(tenant, '/llamadas')
  if ('error' in auth) return auth.error
  const gestor = puedeGestionarColdCalling(auth)
  if (!esCaller(auth) && !gestor) {
    return NextResponse.json({ error: 'Esta pantalla es para el equipo de cold calling' }, { status: 403 })
  }

  const sb = servicio()
  try {
    const como = req.nextUrl.searchParams.get('como')
    let callerId = auth.userId
    let soloLectura = false
    let nombreVista: string | null = null
    if (como && como !== auth.userId) {
      if (!gestor) throw new ErrorColdCalling('Solo puedes ver tu propia lista', 403)
      const persona = esUuid(como) ? (await callersDelTenant(sb, auth.tenantId)).find((c) => c.id === como) : null
      if (!persona) throw new ErrorColdCalling('Esa persona no es una cold caller de esta subcuenta', 404)
      callerId = persona.id
      nombreVista = persona.nombre
      soloLectura = true
    } else if (!esCaller(auth)) {
      // Un gestor sin `?como=` no tiene lista propia: se le manda al panel del equipo.
      return NextResponse.json({ sinLista: true })
    }

    const [{ lanzamientos, launch }, ajustes] = await Promise.all([
      resolverLanzamiento(sb, auth.tenantId, req.nextUrl.searchParams.get('launch')),
      leerAjustes(sb, auth.tenantId),
    ])
    if (!launch) return NextResponse.json({ lanzamientos: [], launch: null, soloLectura, nombreVista })

    const panel = await panelCaller(sb, auth.tenantId, { launch, callerId, ajustes })
    return NextResponse.json({
      lanzamientos,
      launch,
      soloLectura,
      nombreVista,
      estados: ESTADOS,
      ...panel,
    })
  } catch (e) {
    return responderError(e, 'lista')
  }
}

type Cuerpo = {
  accion?: string
  id?: unknown
  status?: unknown
  notes?: unknown
  recordatorioAt?: unknown
  esperado?: unknown
  launch?: unknown
}

// POST /api/[tenant]/evergreen/cold-calling
//   { accion: 'lead', id, status?, notes?, recordatorioAt?, esperado? } → marca un lead propio
//   { accion: 'pedir_mas', launch? }                                     → una tanda más de leads
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requirePantalla(tenant, '/llamadas')
  if ('error' in auth) return auth.error
  const gestor = puedeGestionarColdCalling(auth)
  if (!esCaller(auth) && !gestor) {
    return NextResponse.json({ error: 'Esta pantalla es para el equipo de cold calling' }, { status: 403 })
  }
  const body = await leerJson<Cuerpo>(req)
  if (!body) return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })

  const sb = servicio()
  try {
    if (body.accion === 'lead') {
      if (!esUuid(body.id)) throw new ErrorColdCalling('Falta el lead')
      const lim = limitar(`cold-calling:lead:${auth.tenantId}:${auth.userId}`, 240, 60_000)
      if (!lim.ok) throw new ErrorColdCalling('Demasiados cambios seguidos. Espera unos segundos.', 409)
      const lead = await actualizarLead(sb, auth.tenantId, {
        assignmentId: body.id,
        actorId: auth.userId,
        esGestor: gestor,
        status: body.status,
        notes: body.notes,
        recordatorioAt: body.recordatorioAt,
        esperado: typeof body.esperado === 'string' ? body.esperado : null,
      })
      return NextResponse.json({ ok: true, lead: { id: lead.id, status: lead.status, updatedAt: lead.updated_at } })
    }

    if (body.accion === 'pedir_mas') {
      // Pedir más es de la propia cold caller; un gestor reparte desde el panel del equipo.
      if (!esCaller(auth)) throw new ErrorColdCalling('Reparte leads desde el panel del equipo', 403)
      const lim = limitar(`cold-calling:pedir:${auth.tenantId}:${auth.userId}`, 6, 60_000)
      if (!lim.ok) throw new ErrorColdCalling('Acabas de pedir leads. Espera un momento.', 409)
      const [{ launch }, ajustes] = await Promise.all([
        resolverLanzamiento(sb, auth.tenantId, typeof body.launch === 'string' ? body.launch : null),
        leerAjustes(sb, auth.tenantId),
      ])
      if (!launch) throw new ErrorColdCalling('No hay ningún lanzamiento abierto del que repartir leads')
      const r = await pedirMas(sb, auth.tenantId, { launch, callerId: auth.userId, actorId: auth.userId, ajustes })
      return NextResponse.json({ ok: true, ...r })
    }

    return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 })
  } catch (e) {
    return responderError(e, 'accion')
  }
}
