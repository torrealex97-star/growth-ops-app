import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeForms } from '@/lib/forms/admin'
import { formConfigSchema } from '@/lib/forms/schema'

export const dynamic = 'force-dynamic'

// Respuestas de formularios emparejadas con un contacto (pestaña «Formularios» de su ficha).
// csm solo ve formularios de feedback de alumnos (misma regla que el módulo de formularios).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  const g = await authorizeForms(tenant, false)
  if ('error' in g) return g.error
  const { auth, sb } = g

  const { data, error } = await sb
    .from('form_responses')
    .select(
      'id, form_id, version_id, status, answers, score, temperature, rating, nps, teacher, module, class_name, created_at, forms(name, audience)'
    )
    .eq('tenant_id', auth.tenantId)
    .eq('contact_id', id)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) return NextResponse.json({ error: 'No se pudieron cargar las respuestas' }, { status: 500 })

  type Row = NonNullable<typeof data>[number] & { forms: { name: string; audience: string } | null }
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => auth.role !== 'csm' || r.forms?.audience === 'alumnos')

  const versionIds = [...new Set(rows.map((r) => r.version_id))]
  const titles = new Map<string, Map<string, string>>()
  if (versionIds.length) {
    const { data: vs } = await sb
      .from('form_versions')
      .select('id, config')
      .eq('tenant_id', auth.tenantId)
      .in('id', versionIds)
    for (const v of vs ?? []) {
      const cfg = formConfigSchema.safeParse(v.config)
      if (cfg.success)
        titles.set(
          v.id,
          new Map(
            cfg.data.questions.filter((q) => q.type !== 'hidden' && q.type !== 'statement').map((q) => [q.id, q.title])
          )
        )
    }
  }

  return NextResponse.json({
    responses: rows.map((r) => ({
      id: r.id,
      form_id: r.form_id,
      form: r.forms?.name ?? 'Formulario',
      status: r.status,
      created_at: r.created_at,
      rating: r.rating,
      nps: r.nps,
      score: r.score,
      temperature: r.temperature,
      teacher: r.teacher,
      module: r.module,
      class_name: r.class_name,
      qa: Object.entries((r.answers ?? {}) as Record<string, unknown>)
        .filter(([k]) => titles.get(r.version_id)?.has(k))
        .map(([k, v]) => ({
          q: titles.get(r.version_id)!.get(k)!,
          a: Array.isArray(v) ? v.join(', ') : String(v ?? ''),
        }))
        .filter((x) => x.a !== ''),
    })),
  })
}
