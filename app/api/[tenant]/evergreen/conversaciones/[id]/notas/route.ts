import { NextRequest, NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { requireTenant } from '@/lib/auth/requireTenant'
import { ROLES_GESTION } from '@/lib/conversaciones/acciones'
import { limpiarNota, MAX_NOTA, mencionar, type MiembroEquipo } from '@/lib/conversaciones/notas'

export const runtime = 'nodejs'

type FilaNota = {
  id: string
  body: string
  pinned: boolean
  created_at: string
  users: { full_name: string | null } | { full_name: string | null }[] | null
}

const puente = (rol: string) => (ROLES_GESTION as readonly string[]).includes(rol)
const notaDe = (n: FilaNota) => ({
  id: n.id,
  texto: n.body,
  fijada: n.pinned,
  creadoEn: n.created_at,
  autor: (Array.isArray(n.users) ? n.users[0] : n.users)?.full_name ?? 'Equipo',
})

/**
 * Equipo de gestión de la subcuenta (activos) para las menciones `@`: roles del mismo set que decide
 * `acciones.ts`. Un equipo de gestión vacío NO es un bloqueo: la nota se guarda sin menciones marcadas.
 */
async function equipoGestion(sb: SupabaseClient, tenantId: string): Promise<MiembroEquipo[]> {
  const { data: roles, error: errRoles } = await sb
    .from('roles')
    .select('id,key')
    .in('key', [...ROLES_GESTION])
  if (errRoles) throw errRoles
  const roleIds = ((roles ?? []) as { id: string; key: string }[]).map((r) => r.id)
  if (!roleIds.length) return []
  const { data: miembros, error: errMiembros } = await sb
    .from('tenant_members')
    .select('user_id')
    .eq('tenant_id', tenantId)
  if (errMiembros) throw errMiembros
  const ids = ((miembros ?? []) as { user_id: string }[]).map((m) => m.user_id)
  if (!ids.length) return []
  const { data: personas, error: errPersonas } = await sb
    .from('users')
    .select('id,full_name')
    .in('id', ids)
    .in('role_id', roleIds)
    .eq('is_active', true)
  if (errPersonas) throw errPersonas
  return ((personas ?? []) as { id: string; full_name: string | null }[]).map((u) => ({
    id: u.id,
    nombre: u.full_name ?? 'Equipo',
  }))
}

const sesionDenegada = (rol: string | null, esSuper: boolean) => !esSuper && !puente(rol ?? '')

// NOTAS PRIVADAS de una conversación (patrón Chatwoot). Leer (GET): el equipo de gestión, POR RLS del
// rol resuelto en servidor (la consulta va por service-role escudado por tenant_id; el filtro de roles
// de la política vive en BD). Escribir (POST/PATCH): también solo el equipo de gestión, con auditoría
// en la bitácora (`nota` y `nota_fijar`). Las notas nunca tocan `conversation_messages`: no salen al lead.
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const sesion = await requireTenant(tenant)
  if ('error' in sesion) return sesion.error
  const rol = sesion.isSuperAdmin ? 'admin' : (sesion.role ?? '')
  if (!puente(rol)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Conversación no válida' }, { status: 400 })

  const cuerpo = (await req.json().catch(() => null)) as { texto?: unknown } | null
  const texto = limpiarNota(cuerpo?.texto)
  if (!texto)
    return NextResponse.json({ error: `La nota necesita texto (entre 1 y ${MAX_NOTA} caracteres)` }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: fila, error: errFila } = await sb
    .from('conversations')
    .select('id')
    .eq('tenant_id', sesion.tenantId)
    .eq('id', id)
    .maybeSingle()
  if (errFila) return NextResponse.json({ error: 'No se pudo leer la conversación' }, { status: 500 })
  if (!fila) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 })

  let equipo: MiembroEquipo[] = []
  try {
    equipo = await equipoGestion(sb, sesion.tenantId)
  } catch (e) {
    // Sin nombres no hay menciones marcadas; la nota sigue siendo válida (texto plano).
    console.warn('[conversaciones] lista de equipo no disponible para menciones:', e instanceof Error ? e.message : e)
  }
  const { userIds } = mencionar(texto, equipo)

  const { data: nota, error: errNota } = await sb
    .from('conversation_notes')
    .insert({ tenant_id: sesion.tenantId, conversation_id: id, author_user_id: sesion.userId, body: texto })
    .select('id,body,pinned,created_at,users!conversation_notes_author_user_id_fkey(full_name)')
    .single()
  if (errNota || !nota)
    return NextResponse.json({ error: 'No se pudo guardar la nota' }, { status: errNota ? 500 : 404 })

  const { error: errEvento } = await sb.from('conversation_events').insert({
    tenant_id: sesion.tenantId,
    conversation_id: id,
    actor_user_id: sesion.userId,
    kind: 'nota',
    data: { menciones: userIds },
  })
  // La nota ya está guardada; la pérdida del evento se ve a log (no puede revertir el efecto).
  if (errEvento) console.error('[conversaciones] nota guardada sin evento de bitácora:', errEvento.message)

  return NextResponse.json({
    nota: { ...notaDe(nota as unknown as FilaNota), tokens: mencionar(texto, equipo).tokens },
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const sesion = await requireTenant(tenant)
  if ('error' in sesion) return sesion.error
  const rol = sesion.isSuperAdmin ? 'admin' : (sesion.role ?? '')
  if (!puente(rol)) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Conversación no válida' }, { status: 400 })

  const cuerpo = (await req.json().catch(() => null)) as { notaId?: unknown; fijada?: unknown } | null
  const notaId = typeof cuerpo?.notaId === 'string' && /^[0-9a-f-]{36}$/i.test(cuerpo.notaId) ? cuerpo.notaId : null
  if (!notaId || (cuerpo?.fijada !== true && cuerpo?.fijada !== false))
    return NextResponse.json({ error: 'Petición no válida' }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: fijada, error: errFij } = await sb
    .from('conversation_notes')
    .update({ pinned: cuerpo.fijada, updated_at: new Date().toISOString() })
    .eq('tenant_id', sesion.tenantId)
    .eq('conversation_id', id)
    .eq('id', notaId)
    .select('pinned')
    .maybeSingle()
  if (errFij) return NextResponse.json({ error: 'No se pudo guardar el cambio' }, { status: 500 })
  if (!fijada) return NextResponse.json({ error: 'Nota no encontrada' }, { status: 404 })

  const { error: errEvento } = await sb.from('conversation_events').insert({
    tenant_id: sesion.tenantId,
    conversation_id: id,
    actor_user_id: sesion.userId,
    kind: 'nota_fijar',
    data: { fijar: cuerpo.fijada },
  })
  if (errEvento) console.error('[conversaciones] fijado sin evento de bitácora:', errEvento.message)

  return NextResponse.json({ ok: true, fijada: (fijada as { pinned: boolean }).pinned })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const sesion = await requireTenant(tenant)
  if ('error' in sesion) return sesion.error
  if (sesionDenegada(sesion.role, sesion.isSuperAdmin))
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Conversación no válida' }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const [{ data: fila, error: errFila }, { data: notas, error: errNotas }] = await Promise.all([
    sb.from('conversations').select('id').eq('tenant_id', sesion.tenantId).eq('id', id).maybeSingle(),
    sb
      .from('conversation_notes')
      .select('id,body,pinned,created_at,users!conversation_notes_author_user_id_fkey(full_name)')
      .eq('tenant_id', sesion.tenantId)
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
      .limit(200),
  ])
  if (errFila) return NextResponse.json({ error: 'No se pudo leer la conversación' }, { status: 500 })
  if (errNotas) return NextResponse.json({ error: 'No se pudieron leer las notas' }, { status: 500 })
  if (!fila) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 })

  let equipo: MiembroEquipo[] = []
  try {
    equipo = await equipoGestion(sb, sesion.tenantId)
  } catch (e) {
    console.warn('[conversaciones] lista de equipo no disponible para menciones:', e instanceof Error ? e.message : e)
  }

  return NextResponse.json({
    notas: ((notas ?? []) as FilaNota[]).map((n) => ({ ...notaDe(n), tokens: mencionar(n.body, equipo).tokens })),
    equipo,
  })
}
