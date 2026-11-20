import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeForms, ROLES_ASIGNAR_RESPUESTA } from '@/lib/forms/admin'
import { patronContiene } from '@/lib/search/like'

export const dynamic = 'force-dynamic'

// BÚSQUEDA DE FICHAS para vincular una respuesta de feedback sin `contact_id`.
//
// Va por servidor y no directamente desde el navegador porque el RLS de `contacts` no da la misma
// visibilidad a manager o marketing que a admin: la cola de revisión se quedaría vacía para ellos sin
// ningún error visible («un hueco no es un cero»). El vínculo lo valida el PATCH de la respuesta.
// Solo nombre y email, tope de 10 y los mismos roles que pueden asignar.

const query = z.object({ q: z.string().trim().min(2).max(80) })

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const g = await authorizeForms(tenant, false)
  if ('error' in g) return g.error
  if (!g.auth.role || !(ROLES_ASIGNAR_RESPUESTA as readonly string[]).includes(g.auth.role))
    return NextResponse.json({ error: 'No tienes permiso' }, { status: 403 })

  const q = query.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  const patron = q.success ? patronContiene(q.data.q) : null
  if (!patron) return NextResponse.json({ contactos: [] })

  const { data, error } = await g.sb
    .from('contacts')
    .select('id, full_name, email')
    .eq('tenant_id', g.auth.tenantId)
    .is('merged_into', null)
    .or(`full_name.ilike.${patron},email.ilike.${patron}`)
    .order('full_name', { ascending: true })
    .limit(10)
  if (error) return NextResponse.json({ error: 'No se pudieron buscar fichas' }, { status: 500 })
  return NextResponse.json({ contactos: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}
