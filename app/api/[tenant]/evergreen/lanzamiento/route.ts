import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requirePantalla } from '@/lib/auth/requirePantalla'
import { requireTenant } from '@/lib/auth/requireTenant'
import { businessToday } from '@/lib/dates/business'
import { leerConversiones } from '@/lib/launch/conversiones'
import { leerPaginado } from '@/lib/launch/filas'
import {
  abrirSiguienteLanzamiento,
  borrarProgramado,
  calendario,
  cerrarLanzamiento,
  editarLanzamiento,
  programarLanzamiento,
  siguienteDe,
  type Lanzamiento,
} from '@/lib/launch/lanzamientos'
import { agregarPanel, type FilaPanel } from '@/lib/launch/panel'
import { MOTIVO_SOLO_LECTURA, puedeGestionarLanzamiento } from '@/lib/launch/permisos'

export const runtime = 'nodejs'

/** Tope de filas de detalle por lanzamiento. Por encima, las cifras de detalle se declaran muestra. */
const MAX_FILAS_PANEL = 5000

const PROYECCION_PANEL =
  'id, created_at, confirmed_at, utm, contact_id, contacts!inner(full_name, email, phone, qualification)'

function servicio(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// GET /api/[tenant]/evergreen/lanzamiento[?launch=<id>]
//
// Datos del panel /lanzamiento: calendario, lanzamiento activo, el que se está VIENDO (el activo, o
// el que pida `?launch=` para consultar uno pasado) y sus métricas. Exige acceso a la pantalla
// (requirePantalla): la respuesta lleva nombre, email y teléfono de leads y el cliente es
// service-role, así que pertenecer a la subcuenta no basta. El tenantId de la sesión ya validada va
// estampado en CADA consulta (RLS no protege a un cliente service-role).
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requirePantalla(tenant, '/lanzamiento')
  if ('error' in auth) return auth.error

  const sb = servicio()
  const tenantId = auth.tenantId
  const puedeEditar = puedeGestionarLanzamiento(auth)

  try {
    const cal = await calendario(sb, tenantId)
    const activo = cal.find((l) => l.abierto) ?? null
    const siguiente = siguienteDe(cal)

    // Qué lanzamiento se pinta: el pedido (si es de esta subcuenta y ya se abrió), el activo o, si no
    // hay ninguno abierto, el último que lo estuvo — para que el histórico no desaparezca al cerrar.
    const pedido = req.nextUrl.searchParams.get('launch')
    const visto =
      (pedido ? cal.find((l) => l.id === pedido && l.estado !== 'programado') : null) ??
      activo ??
      cal.find((l) => l.estado === 'cerrado') ??
      null

    const base = {
      calendario: cal,
      activo,
      siguiente,
      visto,
      puedeEditar,
      motivoSoloLectura: puedeEditar ? null : MOTIVO_SOLO_LECTURA,
      // El activo sigue recibiendo leads aunque su evento ya haya pasado: se avisa, no se cierra solo.
      activoPasado: activo ? activo.fecha < businessToday() : false,
    }

    // Contenido e Informe solo necesitan el calendario para su selector: no se les calcula (ni se
    // les manda) el panel entero con los datos de los leads.
    if (req.nextUrl.searchParams.get('solo') === 'calendario') return NextResponse.json(base)

    if (!visto) {
      // Un hueco no es un cero: sin lanzamiento abierto no hay métricas que contar y se dice tal cual.
      return NextResponse.json({ ...base, metricas: null })
    }

    const datos = await leerPanel(sb, tenantId, visto)
    return NextResponse.json({ ...base, ...datos })
  } catch (e) {
    console.error('[lanzamiento] no se pudo leer el panel:', e instanceof Error ? e.message : e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo leer el lanzamiento' },
      { status: 500 }
    )
  }
}

// POST /api/[tenant]/evergreen/lanzamiento
//
// Acciones del calendario, solo para quien gestiona la subcuenta:
//   { accion: 'programar', fecha: 'YYYY-MM-DD', nombre? } → añade una fecha al calendario
//   { accion: 'abrir', esperado?: id }                    → abre el siguiente (claim atómico)
//   { accion: 'editar', id, nombre?, fecha? }             → renombra / mueve la fecha de un programado
//   { accion: 'cerrar', id }                              → pasa un abierto a histórico
//   { accion: 'borrar', id }                              → quita un programado sin abrir
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!puedeGestionarLanzamiento(auth)) {
    return NextResponse.json({ error: MOTIVO_SOLO_LECTURA }, { status: 403 })
  }

  let body: { accion?: string; fecha?: string; nombre?: string; esperado?: string; id?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const texto = (v: unknown) => (typeof v === 'string' ? v : undefined)

  const sb = servicio()
  try {
    switch (body.accion) {
      case 'programar': {
        const fecha = texto(body.fecha)
        if (!fecha) return NextResponse.json({ error: 'Falta la fecha' }, { status: 400 })
        const nuevo = await programarLanzamiento(sb, auth.tenantId, fecha, texto(body.nombre))
        return NextResponse.json({ ok: true, lanzamiento: nuevo })
      }
      case 'abrir': {
        const r = await abrirSiguienteLanzamiento(sb, auth.tenantId, auth.userId, texto(body.esperado))
        return NextResponse.json({ ok: true, ...r })
      }
      case 'editar': {
        const id = texto(body.id)
        if (!id) return NextResponse.json({ error: 'Falta el lanzamiento' }, { status: 400 })
        const editado = await editarLanzamiento(sb, auth.tenantId, id, {
          label: texto(body.nombre),
          fecha: texto(body.fecha),
        })
        return NextResponse.json({ ok: true, lanzamiento: editado })
      }
      case 'cerrar': {
        const id = texto(body.id)
        if (!id) return NextResponse.json({ error: 'Falta el lanzamiento' }, { status: 400 })
        const cerrado = await cerrarLanzamiento(sb, auth.tenantId, id, auth.userId)
        return NextResponse.json({ ok: true, lanzamiento: cerrado })
      }
      case 'borrar': {
        const id = texto(body.id)
        if (!id) return NextResponse.json({ error: 'Falta el lanzamiento' }, { status: 400 })
        await borrarProgramado(sb, auth.tenantId, id)
        return NextResponse.json({ ok: true })
      }
      default:
        return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 })
    }
  } catch (e) {
    // Errores de negocio con mensaje claro (fecha inválida, calendario vacío, doble clic): 400.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo ejecutar la acción' },
      { status: 400 }
    )
  }
}

// ── Lectura de los leads de un lanzamiento ──────────────────────────────────
//
// Proyección estricta (nada de select('*')) y recuentos contados en Postgres. El detalle (calidad,
// anuncios, días) se calcula en memoria sobre las filas del lanzamiento, leídas POR BLOQUES: un
// `.limit(5000)` a secas se queda en el `max_rows` de PostgREST (1000) y daba cifras cortadas sin
// avisar. El agregado vive en lib/launch/panel.ts para poder probarlo con filas reales.
async function leerPanel(sb: SupabaseClient, tenantId: string, launch: Lanzamiento) {
  const conteo = (soloConfirmados: boolean) => {
    const q = sb
      .from('contact_launches')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('launch_id', launch.id)
    return soloConfirmados ? q.not('confirmed_at', 'is', null) : q
  }
  const [resTotal, resConfirmados] = await Promise.all([conteo(false), conteo(true)])
  const primerError = [resTotal, resConfirmados].find((r) => r.error)?.error?.message
  if (primerError) throw new Error(`No se pudieron contar los leads del lanzamiento: ${primerError}`)

  let leido: { filas: FilaPanel[]; truncado: boolean }
  try {
    leido = await leerPaginado<FilaPanel>(
      (desde, hasta) =>
        sb
          .from('contact_launches')
          .select(PROYECCION_PANEL)
          .eq('tenant_id', tenantId)
          .eq('launch_id', launch.id)
          // El desempate por id hace el orden estable entre bloques: sin él, dos filas del mismo
          // instante pueden repetirse o saltarse al paginar.
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(desde, hasta) as unknown as PromiseLike<{
          data: FilaPanel[] | null
          error: { message: string } | null
        }>,
      { max: MAX_FILAS_PANEL }
    )
  } catch (e) {
    throw new Error(`No se pudieron leer los leads del lanzamiento: ${e instanceof Error ? e.message : e}`)
  }

  const primerApuntado = leido.filas.length ? leido.filas[leido.filas.length - 1].created_at : null
  const conversiones = await leerConversiones(
    sb,
    tenantId,
    [...new Set(leido.filas.map((f) => f.contact_id))],
    primerApuntado
  )

  return agregarPanel(leido.filas, {
    total: resTotal.count ?? 0,
    confirmados: resConfirmados.count ?? 0,
    truncado: leido.truncado,
    conversiones,
  })
}
