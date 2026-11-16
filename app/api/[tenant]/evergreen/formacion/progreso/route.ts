import { NextRequest, NextResponse } from 'next/server'

import { requirePantalla } from '@/lib/auth/requirePantalla'
import { servicioFormacion } from '@/lib/formacion/servicio'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Marca o desmarca una lección como hecha PARA QUIEN LLAMA. El user_id sale de la sesión, nunca del cuerpo:
// nadie puede escribir el progreso de otra persona. Idempotente (upsert / delete).
export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requirePantalla(tenant, '/formacion')
  if ('error' in t) return t.error

  let body: { lessonId?: unknown; hecho?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Petición no válida' }, { status: 400 })
  }
  const lessonId = body.lessonId
  if (typeof lessonId !== 'string' || !/^[0-9a-f-]{36}$/i.test(lessonId) || typeof body.hecho !== 'boolean') {
    return NextResponse.json({ error: 'Datos no válidos' }, { status: 400 })
  }

  const sb = servicioFormacion()
  // La lección debe ser de ESTA subcuenta (la FK compuesta también lo exige en BD).
  const { data: leccion, error: eLeccion } = await sb
    .from('training_lessons')
    .select('id')
    .eq('tenant_id', t.tenantId)
    .eq('id', lessonId)
    .maybeSingle()
  if (eLeccion) {
    console.error('[formacion/progreso] lección:', eLeccion.message)
    return NextResponse.json({ error: 'No se pudo guardar el progreso' }, { status: 500 })
  }
  if (!leccion) return NextResponse.json({ error: 'Lección no encontrada' }, { status: 404 })

  const { error } = body.hecho
    ? await sb
        .from('training_progress')
        .upsert(
          { tenant_id: t.tenantId, user_id: t.userId, lesson_id: lessonId, completed_at: new Date().toISOString() },
          { onConflict: 'user_id,lesson_id' }
        )
    : await sb
        .from('training_progress')
        .delete()
        .eq('tenant_id', t.tenantId)
        .eq('user_id', t.userId)
        .eq('lesson_id', lessonId)
  if (error) {
    console.error('[formacion/progreso]:', error.message)
    return NextResponse.json({ error: 'No se pudo guardar el progreso' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
