import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { requirePantalla } from '@/lib/auth/requirePantalla'
import { leerConversiones } from '@/lib/launch/conversiones'
import { leerPaginado } from '@/lib/launch/filas'
import { lanzamientoPorId } from '@/lib/launch/lanzamientos'
import { leadDetalle, leadsACsv, limpiarBusqueda, type FilaPanel } from '@/lib/launch/panel'
import { puedeGestionarLanzamiento } from '@/lib/launch/permisos'
import { limitar } from '@/lib/security/rate-limit'

export const runtime = 'nodejs'

const POR_PAGINA = 50
const MAX_EXPORT = 5000
const PROYECCION =
  'id, created_at, confirmed_at, utm, contact_id, contacts!inner(full_name, email, phone, qualification)'

type Respuesta = { data: FilaPanel[] | null; error: { message: string } | null; count?: number | null }

function servicio(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// GET /api/[tenant]/evergreen/lanzamiento/leads?launch=<id>&q=&estado=&anuncio=&pagina=
//
// Tabla de leads de un lanzamiento, paginada y filtrada EN POSTGRES (no se trae el lanzamiento
// entero para buscar un nombre). `?formato=csv` exporta el filtro actual; como saca datos personales
// en bloque, la exportación queda para quien gestiona la subcuenta.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requirePantalla(tenant, '/lanzamiento')
  if ('error' in auth) return auth.error

  const sp = req.nextUrl.searchParams
  const launchId = sp.get('launch')
  if (!launchId) return NextResponse.json({ error: 'Falta el lanzamiento' }, { status: 400 })

  const sb = servicio()
  const tenantId = auth.tenantId
  const esCsv = sp.get('formato') === 'csv'
  if (esCsv && !puedeGestionarLanzamiento(auth)) {
    return NextResponse.json({ error: 'Solo quien administra la subcuenta puede exportar los leads' }, { status: 403 })
  }

  try {
    const launch = await lanzamientoPorId(sb, tenantId, launchId)
    if (!launch) return NextResponse.json({ error: 'Lanzamiento no encontrado' }, { status: 404 })

    const texto = limpiarBusqueda(sp.get('q'))
    const estado = sp.get('estado')
    const anuncio = (sp.get('anuncio') ?? '').slice(0, 300)

    // El mismo filtro para la página y para la exportación: lo que se ve es lo que se descarga.
    const consulta = (contar: boolean) => {
      let q = sb
        .from('contact_launches')
        .select(PROYECCION, contar ? { count: 'exact' } : undefined)
        .eq('tenant_id', tenantId)
        .eq('launch_id', launch.id)
      if (estado === 'confirmados') q = q.not('confirmed_at', 'is', null)
      if (estado === 'sin_confirmar') q = q.is('confirmed_at', null)
      if (anuncio) q = q.eq('utm->>utm_content', anuncio)
      if (texto) {
        // `texto` ya viene sin comas, paréntesis ni comodines (limpiarBusqueda): no puede cerrar el
        // filtro ni añadir condiciones. Con `!inner`, filtrar el contacto filtra el apuntado.
        const patron = `%${texto}%`
        q = q.or(`full_name.ilike.${patron},email.ilike.${patron},phone.ilike.${patron}`, {
          referencedTable: 'contacts',
        })
      }
      return q.order('created_at', { ascending: false }).order('id', { ascending: false })
    }

    if (esCsv) {
      const lim = limitar(`lanzamiento-csv:${tenantId}:${auth.userId}`, 10, 10 * 60_000)
      if (!lim.ok)
        return NextResponse.json({ error: 'Demasiadas exportaciones seguidas. Espera unos minutos.' }, { status: 429 })
      const { filas, truncado } = await leerPaginado<FilaPanel>(
        (a, b) => consulta(false).range(a, b) as unknown as PromiseLike<Respuesta>,
        { max: MAX_EXPORT }
      )
      const conversiones = await leerConversiones(
        sb,
        tenantId,
        [...new Set(filas.map((f) => f.contact_id))],
        filas.length ? filas[filas.length - 1].created_at : null
      )
      const csv = leadsACsv(filas.map((f) => leadDetalle(f, conversiones)))
      return new NextResponse(`﻿${csv}`, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="leads-${launch.slug}.csv"`,
          'Cache-Control': 'no-store',
          'X-Exportacion-Truncada': truncado ? '1' : '0',
        },
      })
    }

    const pagina = Math.max(0, Math.min(1000, Number.parseInt(sp.get('pagina') ?? '0', 10) || 0))
    const desde = pagina * POR_PAGINA
    const { data, error, count } = (await consulta(true).range(desde, desde + POR_PAGINA - 1)) as unknown as Respuesta
    if (error) throw new Error(error.message)
    const filas = data ?? []
    const conversiones = await leerConversiones(
      sb,
      tenantId,
      [...new Set(filas.map((f) => f.contact_id))],
      // Las conversiones cuentan desde que se abrió el lanzamiento, no desde la fila más vieja de
      // ESTA página (que cambiaría el resultado de un mismo lead según en qué página caiga).
      launch.abiertoAt
    )
    return NextResponse.json({
      leads: filas.map((f) => leadDetalle(f, conversiones)),
      total: count ?? filas.length,
      pagina,
      porPagina: POR_PAGINA,
    })
  } catch (e) {
    console.error('[lanzamiento/leads]', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se pudieron leer los leads del lanzamiento' }, { status: 500 })
  }
}
