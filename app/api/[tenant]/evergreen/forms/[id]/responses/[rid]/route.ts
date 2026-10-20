import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireTenant } from '@/lib/auth/requireTenant'
import { serviceClient } from '@/lib/forms/server'
import { REVIEW_STATUSES } from '@/lib/forms/types'

export const dynamic = 'force-dynamic'
const uuid = z.string().uuid()
const patch = z.object({
  review_status: z.enum(REVIEW_STATUSES).optional(),
  review_notes: z.string().max(2000).nullable().optional(),
})

// Pipeline de revisión de una respuesta (nuevo → contactado → entrevista → …). admin, director,
// manager y marketing; borrar solo admin y director.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ tenant: string; id: string; rid: string }> }
) {
  const { tenant, id, rid } = await params
  if (!uuid.safeParse(id).success || !uuid.safeParse(rid).success)
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!['admin', 'director', 'manager', 'marketing'].includes(auth.role ?? ''))
    return NextResponse.json({ error: 'No tienes permiso' }, { status: 403 })
  const b = patch.safeParse(await req.json().catch(() => null))
  if (!b.success || Object.keys(b.data).length === 0)
    return NextResponse.json({ error: 'Petición no válida' }, { status: 400 })
  const { error, data } = await serviceClient()
    .from('form_responses')
    .update(b.data)
    .eq('tenant_id', auth.tenantId)
    .eq('form_id', id)
    .eq('id', rid)
    .select('id')
    .maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'No se pudo actualizar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ tenant: string; id: string; rid: string }> }
) {
  const { tenant, id, rid } = await params
  if (!uuid.safeParse(id).success || !uuid.safeParse(rid).success)
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!['admin', 'director'].includes(auth.role ?? ''))
    return NextResponse.json({ error: 'No tienes permiso' }, { status: 403 })
  const { error } = await serviceClient()
    .from('form_responses')
    .delete()
    .eq('tenant_id', auth.tenantId)
    .eq('form_id', id)
    .eq('id', rid)
  if (error) return NextResponse.json({ error: 'No se pudo borrar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
