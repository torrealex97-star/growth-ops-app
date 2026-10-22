import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { aplicarAccion, leerAccion } from '@/lib/conversaciones/acciones'

export const runtime = 'nodejs'

// Acciones sobre UNA conversación (resolver, reabrir, aplazar, asignar, etiquetas, traspasar, modo de la IA).
// Las lecturas van por RLS desde el cliente; todo lo que ESCRIBE pasa por aquí (las tablas no admiten
// escritura directa), con el rol resuelto en el servidor y una fila de auditoría por cada cambio.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const sesion = await requireTenant(tenant)
  if ('error' in sesion) return sesion.error
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Conversación no válida' }, { status: 400 })

  const accion = leerAccion(await req.json().catch(() => null))
  if (!accion) return NextResponse.json({ error: 'Acción no válida' }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: fila, error } = await sb
    .from('conversations')
    .select('id,status,snoozed_until,ai_mode,labels,assignee_id')
    .eq('tenant_id', sesion.tenantId)
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'No se pudo leer la conversación' }, { status: 500 })
  if (!fila) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 })

  const rol = sesion.isSuperAdmin ? 'admin' : (sesion.role ?? '')
  const r = aplicarAccion(fila, accion, rol)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })

  const { error: errUp } = await sb
    .from('conversations')
    .update({ ...r.parche, updated_at: new Date().toISOString() })
    .eq('tenant_id', sesion.tenantId)
    .eq('id', id)
  if (errUp) return NextResponse.json({ error: 'No se pudo guardar el cambio' }, { status: 500 })

  await sb.from('conversation_events').insert({
    tenant_id: sesion.tenantId,
    conversation_id: id,
    actor_user_id: sesion.userId,
    kind: r.evento.kind,
    data: r.evento.data,
  })
  return NextResponse.json({ ok: true, ...r.parche })
}
