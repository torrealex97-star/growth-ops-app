import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { ROLES_GESTION } from '@/lib/conversaciones/acciones'
import {
  aGuardableRespuestas,
  CLAVE_RESPUESTAS_RAPIDAS,
  leerRespuestasRapidas,
  ROLES_EDITAR_RESPUESTAS,
} from '@/lib/conversaciones/respuestas-rapidas'

export const runtime = 'nodejs'

const puedeUsar = (rol: string) => (ROLES_GESTION as readonly string[]).includes(rol)
const puedeEditar = (rol: string) => (ROLES_EDITAR_RESPUESTAS as readonly string[]).includes(rol)

// Respuestas rápidas de la subcuenta. Leer: todo el equipo de gestión. Editar: administración/marketing.
// Lo que llega se pasa SIEMPRE por la lectura segura antes de guardarse.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const sesion = await requireTenant(tenant)
  if ('error' in sesion) return sesion.error
  if (!sesion.isSuperAdmin && !puedeUsar(sesion.role ?? ''))
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await sb
    .from('integration_settings')
    .select('value')
    .eq('tenant_id', sesion.tenantId)
    .eq('key', CLAVE_RESPUESTAS_RAPIDAS)
    .maybeSingle()
  return NextResponse.json({
    respuestas: leerRespuestasRapidas((data as { value?: string } | null)?.value ?? null),
    puedeEditar: sesion.isSuperAdmin || puedeEditar(sesion.role ?? ''),
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const sesion = await requireTenant(tenant)
  if ('error' in sesion) return sesion.error
  if (!sesion.isSuperAdmin && !puedeEditar(sesion.role ?? ''))
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  const cuerpo = await req.json().catch(() => null)
  if (typeof cuerpo !== 'object' || cuerpo === null || !Array.isArray((cuerpo as { respuestas?: unknown }).respuestas))
    return NextResponse.json({ error: 'Petición no válida' }, { status: 400 })

  const valor = aGuardableRespuestas((cuerpo as { respuestas: unknown }).respuestas)
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { error } = await sb.from('integration_settings').upsert(
    {
      tenant_id: sesion.tenantId,
      key: CLAVE_RESPUESTAS_RAPIDAS,
      value: valor,
      is_secret: false,
      label: 'Respuestas rápidas de la bandeja de conversaciones',
    },
    { onConflict: 'tenant_id,key' }
  )
  if (error) return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 })
  const { error: errAudit } = await sb.from('audit_logs').insert({
    tenant_id: sesion.tenantId,
    actor_user_id: sesion.userId,
    entity_type: 'conversaciones_respuestas_rapidas',
    entity_id: sesion.tenantId,
    action: 'update',
    new_values: { total: leerRespuestasRapidas(valor).length },
  })
  // La configuración ya se guardó; la auditoría no puede revertirla, así que su fallo se ve a log.
  if (errAudit) console.error('[conversaciones] guardado sin auditoría:', errAudit.message)
  return NextResponse.json({ respuestas: leerRespuestasRapidas(valor) })
}
