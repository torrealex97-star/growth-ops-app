import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import {
  abrirSiguienteLanzamiento,
  calendario,
  lanzamientoActivo,
  programarLanzamiento,
  siguienteLanzamiento,
} from '@/lib/launch/lanzamientos'
import {
  computeAdQuality,
  edadAprox,
  qualityScore,
  qualityScoreJunio,
  resolveFields,
  TEMAS_PIDEN,
  temasDe,
  tramoDinero,
  UMBRAL_LEAD_BUENO,
  type LeadForQuality,
} from '@/lib/launch/calidad'

export const runtime = 'nodejs'

// GET /api/[tenant]/evergreen/lanzamiento
//
// Datos del panel /lanzamiento: calendario, lanzamiento activo, métricas del activo (leads,
// confirmados, calidad), leads por día, ranking de creativos y últimos leads con su nota. El tenant
// sale SIEMPRE de la URL y lo valida requireTenant; el service-role se usa para que las cifras no
// cambien según el rol de quien mira, con el tenantId de la sesión ya validada estampado en CADA
// consulta (RLS no protege a un cliente service-role).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const tenantId = auth.tenantId

  try {
    const [cal, activo, siguiente] = await Promise.all([
      calendario(sb, tenantId),
      lanzamientoActivo(sb, tenantId),
      siguienteLanzamiento(sb, tenantId),
    ])

    if (!activo) {
      // Un hueco no es un cero: sin lanzamiento abierto no hay métricas que contar y se dice tal cual.
      return NextResponse.json({ calendario: cal, activo: null, siguiente, metricas: null })
    }

    const datos = await leerLeadsDelLanzamiento(sb, tenantId, activo.id)
    const anuncios = computeAdQuality(datos.leadsParaCalidad)
    return NextResponse.json({
      calendario: cal,
      activo,
      siguiente,
      metricas: datos.metricas,
      dias: datos.dias,
      // Top por scoreComposite: es la decisión real de dónde meter presupuesto.
      anuncios: anuncios.slice(0, 8),
      leads: datos.recientes,
      edades: datos.edades,
      piden: datos.piden,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo leer el lanzamiento' },
      { status: 500 }
    )
  }
}

// POST /api/[tenant]/evergreen/lanzamiento
//
// Acciones del panel, solo admin/director de la subcuenta:
//   { accion: 'programar', fecha: 'YYYY-MM-DD' } → añade una fecha al calendario
//   { accion: 'abrir', esperado?: id }           → abre el siguiente (claim atómico)
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!['admin', 'director'].includes(auth.role ?? '')) {
    return NextResponse.json({ error: 'Solo admin o director pueden abrir o programar lanzamientos' }, { status: 403 })
  }

  let body: { accion?: string; fecha?: string; esperado?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    if (body.accion === 'programar') {
      if (!body.fecha) return NextResponse.json({ error: 'Falta la fecha' }, { status: 400 })
      const nuevo = await programarLanzamiento(sb, auth.tenantId, body.fecha)
      return NextResponse.json({ ok: true, lanzamiento: nuevo })
    }
    if (body.accion === 'abrir') {
      const resultado = await abrirSiguienteLanzamiento(sb, auth.tenantId, auth.userId, body.esperado)
      return NextResponse.json({ ok: true, ...resultado })
    }
    return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 })
  } catch (e) {
    // Errores de negocio con mensaje claro (fecha inválida, calendario vacío, doble clic): 400.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'No se pudo ejecutar la acción' },
      { status: 400 }
    )
  }
}

// ── Lectura de los leads del lanzamiento activo ─────────────────────────────
//
// Proyección estricta (nada de select('*'): ni qualification entera de más ni payloads ajenos) y
// agregados contados en Postgres donde se puede. El recuento y las medias de calidad se hacen en
// memoria sobre las filas del lanzamiento ACTIVO: un lanzamiento viven unas semanas y las filas son
// de la subcuenta; el agregado en Postgres de un score que vive en un JSONB no vale el RPC.

type FilasLeads = {
  contact_launches: {
    id: string
    created_at: string
    confirmed_at: string | null
    invitado_at: string | null
    utm: Record<string, string> | null
    contact_id: string
  }
  contacts: {
    full_name: string | null
    email: string | null
    phone: string | null
    qualification: Record<string, unknown> | null
  } | null
}

const MAX_FILAS_PANEL = 5000

async function leerLeadsDelLanzamiento(sb: SupabaseClient, tenantId: string, launchId: string) {
  // Conteos con head: no traen filas.
  const [resTotal, resConfirmados, resInvitados] = await Promise.all([
    sb
      .from('contact_launches')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('launch_id', launchId),
    sb
      .from('contact_launches')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('launch_id', launchId)
      .not('confirmed_at', 'is', null),
    sb
      .from('contact_launches')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('launch_id', launchId)
      .not('invitado_at', 'is', null),
  ])
  const primerError = [resTotal, resConfirmados, resInvitados].find((r) => r.error)?.error?.message
  if (primerError) throw new Error(`No se pudieron contar los leads del lanzamiento: ${primerError}`)
  const total = resTotal.count ?? 0
  const confirmados = resConfirmados.count ?? 0
  const invitados = resInvitados.count ?? 0

  const { data: filas, error } = await sb
    .from('contact_launches')
    .select(
      'id, created_at, confirmed_at, invitado_at, utm, contact_id, contacts!inner(full_name, email, phone, qualification)'
    )
    .eq('tenant_id', tenantId)
    .eq('launch_id', launchId)
    .order('created_at', { ascending: false })
    .limit(MAX_FILAS_PANEL)
  if (error) throw new Error(`No se pudieron leer los leads del lanzamiento: ${error.message}`)
  const lista = (filas ?? []) as unknown as FilasLeads[]

  const leadsParaCalidad: LeadForQuality[] = []
  const calidades: number[] = []
  const calidadesJunio: number[] = []
  const edades: number[] = []
  const piden: Record<string, number> = {}
  const porDia = new Map<string, { leads: number; confirmados: number }>()

  for (const f of lista) {
    const q = (f.contacts?.qualification ?? null) as Parameters<typeof resolveFields>[0]
    const fields = resolveFields(q)
    const quality = qualityScore(fields)
    const qualityJunio = qualityScoreJunio(fields)
    const dia = (f.contact_launches.created_at ?? '').slice(0, 10)
    const delDia = porDia.get(dia) ?? { leads: 0, confirmados: 0 }
    delDia.leads += 1
    if (f.contact_launches.confirmed_at) delDia.confirmados += 1
    porDia.set(dia, delDia)

    const citas = 0
    const ventas = 0
    leadsParaCalidad.push({
      id: f.contact_launches.id,
      anuncio: f.contact_launches.utm?.utm_content ?? null,
      campana: f.contact_launches.utm?.utm_campaign ?? null,
      fields,
      quality,
      qualityJunio,
      citas,
      ventas,
      confirmado: Boolean(f.contact_launches.confirmed_at),
    })
    if (quality !== null) calidades.push(quality)
    if (qualityJunio !== null) calidadesJunio.push(qualityJunio)
    const edad = edadAprox(fields.edad)
    if (edad !== null) edades.push(edad)
    // Pregunta abierta "¿qué tendría que pasar…?": temas por palabras clave, deterministas
    // (temasDe); las respuestas basura caen en no_sabe/otros y no se cuentan.
    if (fields.que_piden) {
      for (const tema of temasDe(fields.que_piden)) {
        if (tema === 'no_sabe' || tema === 'otros') continue
        piden[tema] = (piden[tema] ?? 0) + 1
      }
    }
  }

  const media = (xs: number[]) =>
    xs.length > 0 ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null

  const metricas = {
    leads: total,
    /** false cuando el recuento excede MAX_FILAS_PANEL: la media se calcula sobre una muestra y se dice. */
    muestraCompleta: total <= MAX_FILAS_PANEL,
    confirmados,
    invitados,
    conEncuesta: calidades.length,
    avgQuality: media(calidades),
    avgQualityJunio: media(calidadesJunio),
    buenos: calidades.filter((n) => n >= UMBRAL_LEAD_BUENO).length,
    tramoDineroMasComun: tramoComun(lista),
  }

  const dias = [...porDia.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 14)
    .map(([fecha, v]) => ({ fecha, ...v }))

  const recientes = lista.slice(0, 25).map((f) => {
    const fields = resolveFields((f.contacts?.qualification ?? null) as Parameters<typeof resolveFields>[0])
    return {
      id: f.contact_launches.id,
      nombre: f.contacts?.full_name ?? null,
      email: f.contacts?.email ?? null,
      phone: f.contacts?.phone ?? null,
      fecha: f.contact_launches.created_at,
      confirmado: Boolean(f.contact_launches.confirmed_at),
      invitado: Boolean(f.contact_launches.invitado_at),
      anuncio: f.contact_launches.utm?.utm_content ?? null,
      campana: f.contact_launches.utm?.utm_campaign ?? null,
      quality: qualityScore(fields),
    }
  })

  const pidenOrdenado = Object.entries(piden)
    .map(([tema, n]) => ({ tema, n, label: TEMAS_PIDEN.find((t) => t.id === tema)?.label ?? tema }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 6)

  return { metricas, dias, recientes, leadsParaCalidad, edades, piden: pidenOrdenado }
}

/** Tramo de ingresos más común entre los que contestaron, como "0"… "4" o null si nadie contestó. */
function tramoComun(lista: FilasLeads[]): string | null {
  const cuenta: Record<number, number> = {}
  for (const f of lista) {
    const fields = resolveFields((f.contacts?.qualification ?? null) as Parameters<typeof resolveFields>[0])
    const t = tramoDinero(fields.salario)
    if (t !== null) cuenta[t] = (cuenta[t] ?? 0) + 1
  }
  const top = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0]
  return top ? top[0] : null
}
