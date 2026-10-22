import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { aGuardable, CLAVE_CONFIG_AGENTE, leerConfigAgente } from '@/lib/conversaciones/config'
import { ROLES_IA } from '@/lib/conversaciones/acciones'

export const runtime = 'nodejs'

const permitido = (rol: string) => (ROLES_IA as readonly string[]).includes(rol)

// Configuración del agente de setting de ESTA subcuenta. Solo administración (decide si una IA habla en nombre
// del negocio). Lo que llega se pasa SIEMPRE por la lectura segura: no se guarda nada que el agente no pueda leer.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const sesion = await requireTenant(tenant)
  if ('error' in sesion) return sesion.error
  if (!sesion.isSuperAdmin && !permitido(sesion.role ?? ''))
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data } = await sb
    .from('integration_settings')
    .select('value')
    .eq('tenant_id', sesion.tenantId)
    .eq('key', CLAVE_CONFIG_AGENTE)
    .maybeSingle()
  return NextResponse.json(leerConfigAgente((data as { value?: string } | null)?.value ?? null))
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const sesion = await requireTenant(tenant)
  if ('error' in sesion) return sesion.error
  if (!sesion.isSuperAdmin && !permitido(sesion.role ?? ''))
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  const cuerpo = await req.json().catch(() => null)
  if (typeof cuerpo !== 'object' || cuerpo === null)
    return NextResponse.json({ error: 'Petición no válida' }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const valor = aGuardable(cuerpo)
  const { error } = await sb.from('integration_settings').upsert(
    {
      tenant_id: sesion.tenantId,
      key: CLAVE_CONFIG_AGENTE,
      value: valor,
      is_secret: false,
      label: 'Configuración del agente de IA de setting (conversaciones)',
    },
    { onConflict: 'tenant_id,key' }
  )
  if (error) return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 })
  await sb.from('audit_logs').insert({
    tenant_id: sesion.tenantId,
    actor_user_id: sesion.userId,
    entity_type: 'conversaciones_agente',
    entity_id: sesion.tenantId,
    action: 'update',
    new_values: {
      activo: leerConfigAgente(valor).config.activo,
      permitirAutonomo: leerConfigAgente(valor).config.permitirAutonomo,
    },
  })
  return NextResponse.json(leerConfigAgente(valor))
}
