import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import {
  borrarConexionPersonal,
  esTablaInexistente,
  SIN_CONEXION,
  estadoPublico,
  guardarConexionPersonal,
  leerConexionPersonal,
  sincronizarConexionPersonal,
} from '@/lib/fathom/conexion-personal'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Conexión de Fathom del PROPIO usuario (closer, setter…). Cualquier miembro de la subcuenta puede
 * conectar LA SUYA y nunca la de otro: el usuario sale de la sesión, jamás del body. La clave se
 * guarda cifrada y esta ruta no la devuelve nunca.
 */
function servicio() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  try {
    const conexion = await leerConexionPersonal(servicio(), t.tenantId, t.userId)
    return NextResponse.json(estadoPublico(conexion))
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : 'No se pudo leer la conexión'
    if (esTablaInexistente(mensaje)) return NextResponse.json({ ...SIN_CONEXION, migracionPendiente: true })
    return NextResponse.json({ error: mensaje }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  const body = (await req.json().catch(() => ({}))) as { apiKey?: string }
  const sb = servicio()
  const guardada = await guardarConexionPersonal(sb, t.tenantId, t.userId, String(body.apiKey ?? ''))
  if (!guardada.ok) {
    return NextResponse.json(
      { error: guardada.error, codigo: guardada.codigo },
      { status: guardada.codigo === 'vacia' ? 400 : 422 }
    )
  }
  // Primera pasada ya: el closer ve sus reuniones recientes sin esperar al cron. Si se corta o falla,
  // el cron continúa y el estado queda visible; la conexión ya está guardada.
  let resumen = null
  try {
    const conexion = await leerConexionPersonal(sb, t.tenantId, t.userId)
    if (conexion) {
      resumen = await sincronizarConexionPersonal(sb, conexion, {
        paginas: 2,
        porPagina: 25,
        deadlineMs: Date.now() + 25_000,
      })
    }
  } catch {
    resumen = null
  }
  const conexion = await leerConexionPersonal(sb, t.tenantId, t.userId)
  return NextResponse.json({ ...estadoPublico(conexion), primeraPasada: resumen })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requireTenant(tenant)
  if ('error' in t) return t.error
  try {
    await borrarConexionPersonal(servicio(), t.tenantId, t.userId)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo desconectar' }, { status: 500 })
  }
}
