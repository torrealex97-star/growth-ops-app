import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { ROLES_GESTION } from '@/lib/conversaciones/acciones'
import { calcularMetricas, type FilaEvento, type FilaMensaje } from '@/lib/conversaciones/metricas'

export const runtime = 'nodejs'
export const maxDuration = 30

const TOPE_CONVERSACIONES = 1000
const LOTE = 100
const TOPE_FILAS = 20_000

// Métricas operativas del periodo. Acotadas (conversaciones, filas) para no pasarse de egress en el plan
// gratuito: si se llega al tope se dice (`parcial`), nunca se presenta una cifra truncada como completa.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const sesion = await requireTenant(tenant)
  if ('error' in sesion) return sesion.error
  const rol = sesion.isSuperAdmin ? 'admin' : (sesion.role ?? '')
  if (!(ROLES_GESTION as readonly string[]).includes(rol))
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const dias = Math.min(Math.max(Number(req.nextUrl.searchParams.get('dias')) || 30, 1), 90)
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString()
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: convs, error } = await sb
    .from('conversations')
    .select('id,contact_id')
    .eq('tenant_id', sesion.tenantId)
    .gte('last_message_at', desde)
    .limit(TOPE_CONVERSACIONES)
  if (error) return NextResponse.json({ error: 'No se pudieron leer las conversaciones' }, { status: 500 })
  const conversaciones = (convs ?? []) as { id: string; contact_id: string | null }[]
  let parcial = conversaciones.length >= TOPE_CONVERSACIONES

  const mensajes: FilaMensaje[] = []
  const eventos: FilaEvento[] = []
  for (let i = 0; i < conversaciones.length && mensajes.length < TOPE_FILAS; i += LOTE) {
    const ids = conversaciones.slice(i, i + LOTE).map((c) => c.id)
    const [m, e] = await Promise.all([
      sb
        .from('conversation_messages')
        .select('conversation_id,direction,author,sent_at')
        .eq('tenant_id', sesion.tenantId)
        .in('conversation_id', ids)
        .gte('sent_at', desde)
        .limit(5000),
      sb
        .from('conversation_events')
        .select('conversation_id,kind,data')
        .eq('tenant_id', sesion.tenantId)
        .in('conversation_id', ids)
        .in('kind', ['traspaso', 'borrador', 'ia_envio'])
        .gte('created_at', desde)
        .limit(5000),
    ])
    if (m.error || e.error) return NextResponse.json({ error: 'No se pudieron leer los mensajes' }, { status: 500 })
    mensajes.push(...((m.data ?? []) as FilaMensaje[]))
    eventos.push(...((e.data ?? []) as FilaEvento[]))
    if ((m.data?.length ?? 0) >= 5000 || (e.data?.length ?? 0) >= 5000) parcial = true
  }
  if (mensajes.length >= TOPE_FILAS) parcial = true

  // Citas creadas en el periodo de los contactos vinculados: si la consulta falla, queda «sin datos».
  let citas: { contact_id: string | null; created_at: string }[] | null = null
  const contactos = [...new Set(conversaciones.map((c) => c.contact_id).filter((x): x is string => !!x))].slice(0, 400)
  if (contactos.length > 0) {
    const r = await sb
      .from('appointments')
      .select('contact_id,created_at')
      .eq('tenant_id', sesion.tenantId)
      .in('contact_id', contactos)
      .gte('created_at', desde)
      .limit(5000)
    citas = r.error ? null : ((r.data ?? []) as { contact_id: string | null; created_at: string }[])
  } else citas = []

  return NextResponse.json({ dias, parcial, metricas: calcularMetricas(conversaciones, mensajes, eventos, citas) })
}
