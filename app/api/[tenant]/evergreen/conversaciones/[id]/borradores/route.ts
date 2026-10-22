import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { ROLES_GESTION } from '@/lib/conversaciones/acciones'
import { depsReales } from '@/lib/conversaciones/deps-reales'
import { descartarBorrador, enviarComoPersona } from '@/lib/conversaciones/envio'
import { validarBorrador } from '@/lib/conversaciones/redactor'
import { CLAVE_CONFIG_AGENTE, leerConfigAgente } from '@/lib/conversaciones/config'

export const runtime = 'nodejs'
export const maxDuration = 30

// Aprobar (con el texto editado si la persona lo cambia) o descartar un borrador del agente de IA.
// Un borrador editado se vuelve a VALIDAR con las mismas reglas duras que el del modelo: aprobar no es un
// atajo para saltarse que no haya precios, pagos ni enlaces ajenos.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const sesion = await requireTenant(tenant)
  if ('error' in sesion) return sesion.error
  const rol = sesion.isSuperAdmin ? 'admin' : (sesion.role ?? '')
  if (!(ROLES_GESTION as readonly string[]).includes(rol))
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Conversación no válida' }, { status: 400 })

  const c = (await req.json().catch(() => null)) as { accion?: unknown; eventoId?: unknown; texto?: unknown } | null
  const eventoId = typeof c?.eventoId === 'string' && /^[0-9a-f-]{36}$/i.test(c.eventoId) ? c.eventoId : null
  if (!eventoId || (c?.accion !== 'aprobar' && c?.accion !== 'descartar'))
    return NextResponse.json({ error: 'Petición no válida' }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  if (c.accion === 'descartar') {
    const r = await descartarBorrador(sb, sesion.tenantId, id, eventoId, sesion.userId)
    return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status })
  }

  const { data: ajuste } = await sb
    .from('integration_settings')
    .select('value')
    .eq('tenant_id', sesion.tenantId)
    .eq('key', CLAVE_CONFIG_AGENTE)
    .maybeSingle()
  const { guion } = leerConfigAgente((ajuste as { value?: string } | null)?.value ?? null)
  const v = validarBorrador(typeof c.texto === 'string' ? c.texto : '', guion.enlaceAgenda)
  if (!v.ok)
    return NextResponse.json({ error: `El texto no cumple las reglas del agente (${v.motivo})` }, { status: 400 })

  const deps = await depsReales(sesion.tenantId)
  const r = await enviarComoPersona(
    sb,
    sesion.tenantId,
    id,
    v.texto,
    sesion.userId,
    { enviar: deps.enviar },
    { tipo: 'borrador', eventoId }
  )
  return r.ok
    ? NextResponse.json({ ok: true, messageId: r.messageId })
    : NextResponse.json({ error: r.error }, { status: r.status })
}
