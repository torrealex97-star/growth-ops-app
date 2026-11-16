import { NextRequest, NextResponse } from 'next/server'

import { requirePantalla } from '@/lib/auth/requirePantalla'
import { CURSO_ESTANDAR } from '@/lib/formacion/curso-estandar'
import { servicioFormacion } from '@/lib/formacion/servicio'
import { validarRecurso } from '@/lib/formacion/recurso'
import { parsearVideo } from '@/lib/formacion/video'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Formación de colaboradoras. Contenido POR SUBCUENTA. Lectura: cualquiera que pueda ver /formacion
// (`requirePantalla`). Escritura: solo quien administra ESTA subcuenta. El cliente es service-role, así que
// `tenant_id` va explícito en TODAS las consultas (es la única barrera entre subcuentas).

const MAX_CURSOS = 100
const MAX_LECCIONES = 1000

const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 && t.length <= max ? t : null
}
const opcional = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined) return undefined
  if (v === null || (typeof v === 'string' && v.trim() === '')) return null
  return texto(v, max) ?? undefined
}
const esUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requirePantalla(tenant, '/formacion')
  if ('error' in t) return t.error
  const sb = servicioFormacion()

  const [cursos, lecciones, progreso] = await Promise.all([
    sb
      .from('training_courses')
      .select('id, title, description, position')
      .eq('tenant_id', t.tenantId)
      .order('position', { ascending: true })
      .limit(MAX_CURSOS),
    sb
      .from('training_lessons')
      .select('id, course_id, title, description, video_url, video_provider, resource_url, resource_label, position')
      .eq('tenant_id', t.tenantId)
      .order('position', { ascending: true })
      .limit(MAX_LECCIONES),
    sb
      .from('training_progress')
      .select('lesson_id')
      .eq('tenant_id', t.tenantId)
      .eq('user_id', t.userId)
      .limit(MAX_LECCIONES),
  ])
  const fallo = cursos.error ?? lecciones.error ?? progreso.error
  if (fallo) {
    console.error('[formacion] GET:', fallo.message)
    return NextResponse.json({ error: 'No se pudo cargar la formación' }, { status: 500 })
  }
  return NextResponse.json({
    cursos: cursos.data ?? [],
    lecciones: lecciones.data ?? [],
    hechas: (progreso.data ?? []).map((p) => (p as { lesson_id: string }).lesson_id),
    puedeEditar: t.administraTenant,
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requirePantalla(tenant, '/formacion')
  if ('error' in t) return t.error
  if (!t.administraTenant) {
    return NextResponse.json({ error: 'Solo quien administra la subcuenta puede editar la formación' }, { status: 403 })
  }
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Petición no válida' }, { status: 400 })
  }
  const sb = servicioFormacion()
  const ahora = new Date().toISOString()
  const error = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })
  const fallaBD = (ctx: string, e: { message: string }) => {
    console.error(`[formacion] ${ctx}:`, e.message)
    return error('No se pudo guardar el cambio', 500)
  }

  // Siguiente posición = máxima actual + 1, dentro del ámbito (subcuenta para cursos, curso para lecciones).
  const siguientePosicion = async (tabla: 'training_courses' | 'training_lessons', cursoId?: string) => {
    let q = sb.from(tabla).select('position').eq('tenant_id', t.tenantId)
    if (cursoId) q = q.eq('course_id', cursoId)
    const { data } = await q.order('position', { ascending: false }).limit(1)
    return ((data?.[0] as { position?: number } | undefined)?.position ?? -1) + 1
  }

  // Valida el enlace y devuelve la forma embebible canónica (nunca se guarda la cadena del usuario tal cual).
  const videoDe = (raw: unknown): { url: string | null; proveedor: string | null } | 'invalido' => {
    const crudo = opcional(raw, 600)
    if (crudo === undefined) return 'invalido'
    if (crudo === null) return { url: null, proveedor: null }
    const v = parsearVideo(crudo)
    return v ? { url: v.embedUrl, proveedor: v.proveedor } : 'invalido'
  }
  const recursoDe = (url: unknown, etiqueta: unknown) => {
    const r = validarRecurso(url, etiqueta)
    return r.ok ? r : null
  }
  const ERR_RECURSO = 'El recurso debe ser un enlace https válido (y su nombre, de hasta 80 caracteres).'
  const ERR_VIDEO = 'Enlace de vídeo no admitido. Usa YouTube, Loom, Wistia, Vimeo o Bunny (https).'

  switch (body.action) {
    case 'crear_curso': {
      const title = texto(body.title, 160)
      const description = opcional(body.description, 2000)
      if (!title || description === undefined) return error('Título obligatorio (máx. 160) y descripción de hasta 2000')
      const { data, error: e } = await sb
        .from('training_courses')
        .insert({
          tenant_id: t.tenantId,
          title,
          description,
          position: await siguientePosicion('training_courses'),
          created_by: t.userId,
        })
        .select('id')
        .single()
      if (e) return fallaBD('crear_curso', e)
      return NextResponse.json({ ok: true, id: (data as { id: string }).id })
    }
    case 'editar_curso': {
      const title = texto(body.title, 160)
      const description = opcional(body.description, 2000)
      if (!esUuid(body.id) || !title || description === undefined) return error('Datos no válidos')
      const { error: e } = await sb
        .from('training_courses')
        .update({ title, description, updated_at: ahora })
        .eq('tenant_id', t.tenantId)
        .eq('id', body.id)
      if (e) return fallaBD('editar_curso', e)
      return NextResponse.json({ ok: true })
    }
    case 'borrar_curso': {
      if (!esUuid(body.id)) return error('Datos no válidos')
      const { error: e } = await sb.from('training_courses').delete().eq('tenant_id', t.tenantId).eq('id', body.id)
      if (e) return fallaBD('borrar_curso', e)
      return NextResponse.json({ ok: true })
    }
    case 'crear_leccion': {
      const title = texto(body.title, 160)
      const description = opcional(body.description, 4000)
      const video = videoDe(body.videoUrl)
      const recurso = recursoDe(body.resourceUrl, body.resourceLabel)
      if (!esUuid(body.courseId) || !title || description === undefined) return error('Datos no válidos')
      if (video === 'invalido') return error(ERR_VIDEO)
      if (!recurso) return error(ERR_RECURSO)
      // El curso debe ser de ESTA subcuenta (la FK compuesta lo exige también en BD).
      const { data: curso } = await sb
        .from('training_courses')
        .select('id')
        .eq('tenant_id', t.tenantId)
        .eq('id', body.courseId)
        .maybeSingle()
      if (!curso) return error('Curso no encontrado', 404)
      const { data, error: e } = await sb
        .from('training_lessons')
        .insert({
          tenant_id: t.tenantId,
          course_id: body.courseId,
          title,
          description,
          video_url: video.url,
          video_provider: video.proveedor,
          resource_url: recurso.url,
          resource_label: recurso.etiqueta,
          position: await siguientePosicion('training_lessons', body.courseId),
        })
        .select('id')
        .single()
      if (e) return fallaBD('crear_leccion', e)
      return NextResponse.json({ ok: true, id: (data as { id: string }).id })
    }
    case 'editar_leccion': {
      const title = texto(body.title, 160)
      const description = opcional(body.description, 4000)
      const video = videoDe(body.videoUrl)
      const recurso = recursoDe(body.resourceUrl, body.resourceLabel)
      if (!esUuid(body.id) || !title || description === undefined) return error('Datos no válidos')
      if (video === 'invalido') return error(ERR_VIDEO)
      if (!recurso) return error(ERR_RECURSO)
      const { error: e } = await sb
        .from('training_lessons')
        .update({
          title,
          description,
          video_url: video.url,
          video_provider: video.proveedor,
          resource_url: recurso.url,
          resource_label: recurso.etiqueta,
          updated_at: ahora,
        })
        .eq('tenant_id', t.tenantId)
        .eq('id', body.id)
      if (e) return fallaBD('editar_leccion', e)
      return NextResponse.json({ ok: true })
    }
    case 'borrar_leccion': {
      if (!esUuid(body.id)) return error('Datos no válidos')
      const { error: e } = await sb.from('training_lessons').delete().eq('tenant_id', t.tenantId).eq('id', body.id)
      if (e) return fallaBD('borrar_leccion', e)
      return NextResponse.json({ ok: true })
    }
    case 'curso_estandar': {
      // Idempotente: si ya existe un curso con ese título en la subcuenta, no se duplica.
      const { data: previo } = await sb
        .from('training_courses')
        .select('id')
        .eq('tenant_id', t.tenantId)
        .eq('title', CURSO_ESTANDAR.title)
        .limit(1)
      if (previo && previo.length > 0) return NextResponse.json({ ok: true, creado: false })
      const { data: curso, error: ec } = await sb
        .from('training_courses')
        .insert({
          tenant_id: t.tenantId,
          title: CURSO_ESTANDAR.title,
          description: CURSO_ESTANDAR.description,
          position: await siguientePosicion('training_courses'),
          created_by: t.userId,
        })
        .select('id')
        .single()
      if (ec || !curso) return fallaBD('curso_estandar', ec ?? { message: 'sin fila' })
      const cursoId = (curso as { id: string }).id
      const { error: el } = await sb.from('training_lessons').insert(
        CURSO_ESTANDAR.lecciones.map((l, i) => ({
          tenant_id: t.tenantId,
          course_id: cursoId,
          title: l.title,
          description: l.description,
          position: i,
        }))
      )
      if (el) {
        // Sin lecciones el curso quedaría vacío y no se podría volver a sembrar (ya existe): se deshace.
        await sb.from('training_courses').delete().eq('tenant_id', t.tenantId).eq('id', cursoId)
        return fallaBD('curso_estandar/lecciones', el)
      }
      return NextResponse.json({ ok: true, creado: true, id: cursoId })
    }
    default:
      return error('Acción no válida')
  }
}
