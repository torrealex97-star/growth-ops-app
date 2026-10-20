import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeForms, denyIfNotVisible } from '@/lib/forms/admin'
import { formConfigSchema } from '@/lib/forms/schema'
import { FORM_AUDIENCES, FORM_CATEGORIES } from '@/lib/forms/types'

export const dynamic = 'force-dynamic'
const uuid = z.string().uuid()

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  const g = await authorizeForms(tenant, false)
  if ('error' in g) return g.error
  const { auth, sb } = g
  const denied = await denyIfNotVisible(sb, auth.tenantId, auth.role, id)
  if (denied) return denied
  const { data, error } = await sb
    .from('forms')
    .select('id, slug, name, category, audience, status, draft_config, published_version_id, settings, updated_at')
    .eq('tenant_id', auth.tenantId)
    .eq('id', id)
    .maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'Formulario no encontrado' }, { status: 404 })
  let publishedVersion: number | null = null
  if (data.published_version_id) {
    const { data: v } = await sb
      .from('form_versions')
      .select('version')
      .eq('tenant_id', auth.tenantId)
      .eq('id', data.published_version_id)
      .maybeSingle()
    publishedVersion = v?.version ?? null
  }
  return NextResponse.json({
    form: data,
    publishedVersion,
    canWrite: ['admin', 'director', 'marketing'].includes(auth.role ?? ''),
  })
}

const putBody = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  category: z.enum(FORM_CATEGORIES).optional(),
  audience: z.enum(FORM_AUDIENCES).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  draft_config: formConfigSchema.optional(),
  settings: z
    .object({
      closeAt: z.string().datetime().nullish(),
      maxResponses: z.number().int().min(1).max(1_000_000).nullish(),
    })
    .optional(),
})

export async function PUT(req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  if (!uuid.safeParse(id).success) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  const g = await authorizeForms(tenant, true)
  if ('error' in g) return g.error
  const { auth, sb } = g

  const parsed = putBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success)
    return NextResponse.json(
      {
        error: 'Configuración no válida',
        detail: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 400 }
    )
  const b = parsed.data

  // `published` solo se alcanza publicando (crea la versión); aquí solo se archiva o se vuelve a borrador.
  if (b.status === 'published') return NextResponse.json({ error: 'Usa Publicar para publicar' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (b.name !== undefined) patch.name = b.name
  if (b.category !== undefined) patch.category = b.category
  if (b.audience !== undefined) patch.audience = b.audience
  if (b.draft_config !== undefined) patch.draft_config = b.draft_config
  if (b.settings !== undefined) {
    const s: Record<string, unknown> = {}
    if (b.settings.closeAt) s.closeAt = b.settings.closeAt
    if (b.settings.maxResponses) s.maxResponses = b.settings.maxResponses
    patch.settings = s
  }
  if (b.status !== undefined) patch.status = b.status
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })

  const { data, error } = await sb
    .from('forms')
    .update(patch)
    .eq('tenant_id', auth.tenantId)
    .eq('id', id)
    .select('id, updated_at')
    .maybeSingle()
  if (error || !data) return NextResponse.json({ error: 'No se pudo guardar' }, { status: 500 })
  return NextResponse.json({ ok: true, updated_at: data.updated_at })
}
