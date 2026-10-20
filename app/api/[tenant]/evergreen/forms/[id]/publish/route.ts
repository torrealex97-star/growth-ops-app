import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeForms } from '@/lib/forms/admin'
import { formConfigSchema } from '@/lib/forms/schema'
import { validateConfig } from '@/lib/forms/validation'

export const dynamic = 'force-dynamic'

// Publicar = congelar el borrador en una VERSIÓN inmutable y apuntar el formulario a ella. Las
// respuestas ya recibidas conservan su versión: editar y republicar nunca las corrompe.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  const g = await authorizeForms(tenant, true)
  if ('error' in g) return g.error
  const { auth, sb } = g

  const { data: form } = await sb
    .from('forms')
    .select('id, draft_config')
    .eq('tenant_id', auth.tenantId)
    .eq('id', id)
    .maybeSingle()
  if (!form) return NextResponse.json({ error: 'Formulario no encontrado' }, { status: 404 })

  const cfg = formConfigSchema.safeParse(form.draft_config)
  if (!cfg.success)
    return NextResponse.json(
      {
        error: 'El borrador no es válido',
        problems: cfg.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 422 }
    )
  const problems = validateConfig(cfg.data as never)
  if (problems.length > 0)
    return NextResponse.json({ error: 'Corrige estos problemas antes de publicar', problems }, { status: 422 })

  const { data: last } = await sb
    .from('form_versions')
    .select('version')
    .eq('tenant_id', auth.tenantId)
    .eq('form_id', id)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const version = (last?.version ?? 0) + 1

  const { data: v, error } = await sb
    .from('form_versions')
    .insert({ tenant_id: auth.tenantId, form_id: id, version, config: cfg.data, published_by: auth.userId })
    .select('id')
    .single()
  if (error || !v) return NextResponse.json({ error: 'No se pudo publicar' }, { status: 500 })

  const { error: upErr } = await sb
    .from('forms')
    .update({ status: 'published', published_version_id: v.id })
    .eq('tenant_id', auth.tenantId)
    .eq('id', id)
  if (upErr) return NextResponse.json({ error: 'No se pudo publicar' }, { status: 500 })
  return NextResponse.json({ ok: true, version })
}
