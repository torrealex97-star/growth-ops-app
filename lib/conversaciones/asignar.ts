import type { SupabaseClient } from '@supabase/supabase-js'
import { elegirResponsable, type Candidato } from './reparto'

// Asigna una conversación SIN responsable a un setter activo de la subcuenta (round-robin). Solo rellena un hueco:
// jamás pisa una asignación hecha por una persona (`assignee_id is null` en el propio update).

const ROL_REPARTO = 'setter'
const TOPE_CARGA = 40

export async function asignarRoundRobin(
  sb: SupabaseClient,
  tenantId: string,
  conversationId: string
): Promise<string | null> {
  try {
    // El rol de negocio (setter) vive en users.role_id → roles.key; tenant_members solo dice quién pertenece.
    const { data: rol } = await sb.from('roles').select('id').eq('key', ROL_REPARTO).maybeSingle()
    const rolId = (rol as { id: string } | null)?.id
    if (!rolId) return null
    const { data: miembros } = await sb.from('tenant_members').select('user_id').eq('tenant_id', tenantId)
    const ids = ((miembros ?? []) as { user_id: string }[]).map((m) => m.user_id)
    if (!ids.length) return null

    const { data: activos } = await sb
      .from('users')
      .select('id')
      .in('id', ids)
      .eq('role_id', rolId)
      .eq('is_active', true)
    const elegibles = ((activos ?? []) as { id: string }[]).map((u) => u.id)
    if (!elegibles.length) return null

    const { data: vivas } = await sb
      .from('conversations')
      .select('assignee_id')
      .eq('tenant_id', tenantId)
      .in('assignee_id', elegibles)
      .in('status', ['abierta', 'pendiente'])
      .limit(2000)
    const carga = new Map<string, number>()
    for (const f of (vivas ?? []) as { assignee_id: string }[])
      carga.set(f.assignee_id, (carga.get(f.assignee_id) ?? 0) + 1)

    const { data: previas } = await sb
      .from('conversation_events')
      .select('data,created_at')
      .eq('tenant_id', tenantId)
      .eq('kind', 'asignacion')
      .order('created_at', { ascending: false })
      .limit(300)
    const ultima = new Map<string, string>()
    for (const e of (previas ?? []) as { data: { a?: string | null }; created_at: string }[]) {
      const a = e.data?.a
      if (a && !ultima.has(a)) ultima.set(a, e.created_at)
    }

    const candidatos: Candidato[] = elegibles.map((id) => ({
      id,
      cargaViva: carga.get(id) ?? 0,
      ultimaAsignacion: ultima.get(id) ?? null,
    }))
    const elegido = elegirResponsable(candidatos, TOPE_CARGA)
    if (!elegido) return null

    const { data: hecho } = await sb
      .from('conversations')
      .update({ assignee_id: elegido, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('id', conversationId)
      .is('assignee_id', null)
      .select('id')
      .maybeSingle()
    if (!hecho) return null
    await sb.from('conversation_events').insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      kind: 'asignacion',
      data: { de: null, a: elegido, auto: true },
    })
    return elegido
  } catch (e) {
    console.warn('[conversaciones] reparto no disponible:', e instanceof Error ? e.message : e)
    return null
  }
}
