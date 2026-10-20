import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeForms, slugify } from '@/lib/forms/admin'
import { FORM_AUDIENCES, FORM_CATEGORIES } from '@/lib/forms/types'
import { blankConfig, templateByKey } from '@/lib/forms/templates'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const g = await authorizeForms(tenant, false)
  if ('error' in g) return g.error
  const { auth, sb } = g

  const { data: forms, error } = await sb
    .from('forms')
    .select('id, slug, name, category, audience, status, published_version_id, updated_at, created_at')
    .eq('tenant_id', auth.tenantId)
    .order('updated_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: 'No se pudieron cargar los formularios' }, { status: 500 })

  // Conteos por formulario (pocos formularios por subcuenta: una consulta head por cada uno).
  const withCounts = await Promise.all(
    (forms ?? []).map(async (f) => {
      const [done, views] = await Promise.all([
        sb
          .from('form_responses')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', auth.tenantId)
          .eq('form_id', f.id)
          .eq('status', 'completed'),
        sb
          .from('form_sessions')
          .select('id', { count: 'exact', head: true })
          .eq('tenant_id', auth.tenantId)
          .eq('form_id', f.id),
      ])
      return { ...f, responses: done.count ?? 0, sessions: views.count ?? 0 }
    })
  )
  return NextResponse.json({
    forms: withCounts,
    canWrite: ['admin', 'director', 'marketing'].includes(auth.role ?? ''),
  })
}

const createBody = z.object({
  templateKey: z.string().max(60).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  category: z.enum(FORM_CATEGORIES).optional(),
  audience: z.enum(FORM_AUDIENCES).optional(),
})

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const g = await authorizeForms(tenant, true)
  if ('error' in g) return g.error
  const { auth, sb } = g

  const parsed = createBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Petición no válida' }, { status: 400 })
  const b = parsed.data
  const tpl = b.templateKey ? templateByKey(b.templateKey) : undefined
  if (b.templateKey && !tpl) return NextResponse.json({ error: 'Plantilla no encontrada' }, { status: 404 })

  const name = b.name ?? tpl?.name ?? 'Nuevo formulario'
  const baseSlug = slugify(tpl?.slug ?? name)
  const { data: taken } = await sb
    .from('forms')
    .select('slug')
    .eq('tenant_id', auth.tenantId)
    .like('slug', `${baseSlug}%`)
    .limit(100)
  const used = new Set((taken ?? []).map((r) => r.slug as string))
  let slug = baseSlug
  for (let i = 2; used.has(slug); i++) slug = `${baseSlug}-${i}`.slice(0, 80)

  const { data, error } = await sb
    .from('forms')
    .insert({
      tenant_id: auth.tenantId,
      slug,
      name,
      category: b.category ?? tpl?.category ?? 'otro',
      audience: b.audience ?? tpl?.audience ?? 'captacion',
      draft_config: tpl?.config ?? blankConfig(),
      created_by: auth.userId,
    })
    .select('id, slug')
    .single()
  if (error || !data) return NextResponse.json({ error: 'No se pudo crear el formulario' }, { status: 500 })
  return NextResponse.json({ id: data.id, slug: data.slug })
}
