import { NextRequest, NextResponse } from 'next/server'

import { ROLE_LABELS } from '@/lib/auth/permissions'
import { requirePantalla } from '@/lib/auth/requirePantalla'
import { CURSO_ESTANDAR } from '@/lib/formacion/curso-estandar'
import { MAX_SOPS_POR_LECCION, validarSop } from '@/lib/formacion/recurso'
import { servicioFormacion } from '@/lib/formacion/servicio'
import { parsearVideo } from '@/lib/formacion/video'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Formación del equipo (SOPs y vídeos por rol). Contenido POR SUBCUENTA. Lectura: cualquier miembro (pantalla
// universal), y cada persona ve los cursos de su rol; quien administra la subcuenta ve todos. Escritura: solo quien
// administra ESTA subcuenta. El cliente es service-role, así que `tenant_id` va explícito en TODAS las consultas
// (es la única barrera entre subcuentas).

const MAX_CURSOS = 100
const MAX_LECCIONES = 1000
const ROLES_VALIDOS = new Set(Object.keys(ROLE_LABELS))
const SEED_ESTANDAR = 'estandar'

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

/** Público del curso: vacío/ausente = todo el equipo; si no, solo roles que existen. `'invalido'` si algo no cuadra. */
const publicoDe = (v: unknown): string[] | null | 'invalido' => {
  if (v === undefined || v === null) return null
  if (!Array.isArray(v)) return 'invalido'
  const roles = [...new Set(v)]
  if (roles.length === 0) return null
  if (roles.length > 20 || roles.some((r) => typeof r !== 'string' || !ROLES_VALIDOS.has(r))) return 'invalido'
  return roles as string[]
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const t = await requirePantalla(tenant, '/formacion')
  if ('error' in t) return t.error
  const sb = servicioFormacion()
  // `?resumen=1`: lo que necesita la tarjeta del dashboard (títulos y orden), sin descripciones ni enlaces.
  const resumen = req.nextUrl.searchParams.get('resumen') === '1'
  // `?gestionar=1`: solo quien administra la subcuenta ve TODOS los cursos (para editarlos). Sin él, todo el mundo,
  // administradores incluidos, ve únicamente la formación de su propio rol: un admin no debe ver como suyo el curso de
  // las colaboradoras.
  const gestionar = t.administraTenant && req.nextUrl.searchParams.get('gestionar') === '1'

  let cursosQ = sb
    .from('training_courses')
    .select(resumen ? 'id, position' : 'id, title, description, position, audience_roles, seed_key')
    .eq('tenant_id', t.tenantId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(MAX_CURSOS)
  // Solo el modo «gestionar» de un administrador ve todo; la pantalla normal y la tarjeta (`resumen`) son «lo que me
  // toca a mí» y filtran por el rol de cada persona, administradores incluidos.
  if (!gestionar || resumen) {
    // El rol sale de la sesión (nunca del cliente) y solo se interpola si tiene la forma de una clave de rol.
    const rol = t.role && /^[a-z_]+$/.test(t.role) ? t.role : null
    cursosQ = rol ? cursosQ.or(`audience_roles.is.null,audience_roles.cs.{${rol}}`) : cursosQ.is('audience_roles', null)
  }
  const cursos = await cursosQ
  if (cursos.error) {
    console.error('[formacion] GET cursos:', cursos.error.message)
    return NextResponse.json({ error: 'No se pudo cargar la formación' }, { status: 500 })
  }
  const filasCursos = (cursos.data ?? []) as unknown as { id: string }[]
  const idsCursos = filasCursos.map((c) => c.id)

  // Sin cursos visibles no hay nada que leer: una sola consulta en vez de tres. Es el caso más común (la tarjeta
  // del dashboard lo pide en cada carga de cada rol).
  if (idsCursos.length === 0) {
    return NextResponse.json({ cursos: [], lecciones: [], hechas: [], puedeEditar: t.administraTenant })
  }

  const [lecciones, progreso] = await Promise.all([
    sb
      .from('training_lessons')
      .select(
        resumen
          ? 'id, course_id, title, position'
          : 'id, course_id, title, description, video_url, video_provider, position'
      )
      .eq('tenant_id', t.tenantId)
      .in('course_id', idsCursos)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(MAX_LECCIONES),
    sb
      .from('training_progress')
      .select('lesson_id')
      .eq('tenant_id', t.tenantId)
      .eq('user_id', t.userId)
      .limit(MAX_LECCIONES),
  ])
  const fallo = lecciones.error ?? progreso.error
  if (fallo) {
    console.error('[formacion] GET:', fallo.message)
    return NextResponse.json({ error: 'No se pudo cargar la formación' }, { status: 500 })
  }
  // SOPs (enlaces a documentos) de las lecciones visibles. El modo ligero de la tarjeta no los necesita. Se piden por
  // subcuenta y se filtran aquí por las lecciones visibles: un `.in('lesson_id', …)` con cientos de ids revienta el
  // límite de longitud de la URL de PostgREST. Están acotados (máx. MAX_SOPS_POR_LECCION por lección).
  let recursos: unknown[] = []
  const idsLecciones = new Set(((lecciones.data ?? []) as unknown as { id: string }[]).map((l) => l.id))
  if (!resumen && idsLecciones.size > 0) {
    const sops = await sb
      .from('training_resources')
      .select('id, lesson_id, title, url, position')
      .eq('tenant_id', t.tenantId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(MAX_LECCIONES * MAX_SOPS_POR_LECCION)
    if (sops.error) {
      console.error('[formacion] GET sops:', sops.error.message)
      return NextResponse.json({ error: 'No se pudo cargar la formación' }, { status: 500 })
    }
    recursos = ((sops.data ?? []) as unknown as { lesson_id: string }[]).filter((r) => idsLecciones.has(r.lesson_id))
  }
  return NextResponse.json({
    cursos: filasCursos,
    lecciones: lecciones.data ?? [],
    recursos,
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
  // Dos altas simultáneas pueden empatar: el listado desempata por fecha e id, así que el orden sigue siendo estable.
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
  const ERR_SOP = 'El SOP necesita un nombre (hasta 120 caracteres) y un enlace https válido.'
  const ERR_VIDEO = 'Enlace de vídeo no admitido. Usa YouTube, Loom, Wistia, Vimeo o Bunny (https).'
  const ERR_PUBLICO = 'El público del curso no es válido.'

  switch (body.action) {
    case 'crear_curso': {
      const title = texto(body.title, 160)
      const description = opcional(body.description, 2000)
      const publico = publicoDe(body.audienceRoles)
      if (!title || description === undefined) return error('Título obligatorio (máx. 160) y descripción de hasta 2000')
      if (publico === 'invalido') return error(ERR_PUBLICO)
      const { data, error: errBD } = await sb
        .from('training_courses')
        .insert({
          tenant_id: t.tenantId,
          title,
          description,
          audience_roles: publico,
          position: await siguientePosicion('training_courses'),
          created_by: t.userId,
        })
        .select('id')
        .single()
      if (errBD) return fallaBD('crear_curso', errBD)
      return NextResponse.json({ ok: true, id: (data as { id: string }).id })
    }
    case 'editar_curso': {
      const title = texto(body.title, 160)
      const description = opcional(body.description, 2000)
      // Si el cuerpo no trae `audienceRoles` el público NO se toca: omitirlo no puede abrir el curso a todo el equipo.
      const publico = 'audienceRoles' in body ? publicoDe(body.audienceRoles) : undefined
      if (!esUuid(body.id) || !title || description === undefined) return error('Datos no válidos')
      if (publico === 'invalido') return error(ERR_PUBLICO)
      const { data, error: errBD } = await sb
        .from('training_courses')
        .update({
          title,
          description,
          ...(publico !== undefined ? { audience_roles: publico } : {}),
          updated_at: ahora,
        })
        .eq('tenant_id', t.tenantId)
        .eq('id', body.id)
        .select('id')
      if (errBD) return fallaBD('editar_curso', errBD)
      if (!data?.length) return error('Curso no encontrado', 404)
      return NextResponse.json({ ok: true })
    }
    case 'borrar_curso': {
      if (!esUuid(body.id)) return error('Datos no válidos')
      const { data, error: errBD } = await sb
        .from('training_courses')
        .delete()
        .eq('tenant_id', t.tenantId)
        .eq('id', body.id)
        .select('id')
      if (errBD) return fallaBD('borrar_curso', errBD)
      if (!data?.length) return error('Curso no encontrado', 404)
      return NextResponse.json({ ok: true })
    }
    case 'crear_leccion': {
      const title = texto(body.title, 160)
      const description = opcional(body.description, 4000)
      const video = videoDe(body.videoUrl)
      if (!esUuid(body.courseId) || !title || description === undefined) return error('Datos no válidos')
      if (video === 'invalido') return error(ERR_VIDEO)
      // El curso debe ser de ESTA subcuenta (la FK compuesta lo exige también en BD).
      const { data: curso } = await sb
        .from('training_courses')
        .select('id')
        .eq('tenant_id', t.tenantId)
        .eq('id', body.courseId)
        .maybeSingle()
      if (!curso) return error('Curso no encontrado', 404)
      const { data, error: errBD } = await sb
        .from('training_lessons')
        .insert({
          tenant_id: t.tenantId,
          course_id: body.courseId,
          title,
          description,
          video_url: video.url,
          video_provider: video.proveedor,
          position: await siguientePosicion('training_lessons', body.courseId),
        })
        .select('id')
        .single()
      if (errBD) return fallaBD('crear_leccion', errBD)
      return NextResponse.json({ ok: true, id: (data as { id: string }).id })
    }
    case 'editar_leccion': {
      const title = texto(body.title, 160)
      const description = opcional(body.description, 4000)
      const video = videoDe(body.videoUrl)
      if (!esUuid(body.id) || !title || description === undefined) return error('Datos no válidos')
      if (video === 'invalido') return error(ERR_VIDEO)
      const { data, error: errBD } = await sb
        .from('training_lessons')
        .update({
          title,
          description,
          video_url: video.url,
          video_provider: video.proveedor,
          updated_at: ahora,
        })
        .eq('tenant_id', t.tenantId)
        .eq('id', body.id)
        .select('id')
      if (errBD) return fallaBD('editar_leccion', errBD)
      if (!data?.length) return error('Lección no encontrada', 404)
      return NextResponse.json({ ok: true })
    }
    case 'borrar_leccion': {
      if (!esUuid(body.id)) return error('Datos no válidos')
      const { data, error: errBD } = await sb
        .from('training_lessons')
        .delete()
        .eq('tenant_id', t.tenantId)
        .eq('id', body.id)
        .select('id')
      if (errBD) return fallaBD('borrar_leccion', errBD)
      if (!data?.length) return error('Lección no encontrada', 404)
      return NextResponse.json({ ok: true })
    }
    case 'crear_sop': {
      const sop = validarSop(body.url, body.title)
      if (!esUuid(body.lessonId) || !sop.ok) return error(ERR_SOP)
      // La lección debe ser de ESTA subcuenta y no pasarse del máximo de SOPs.
      const { data: leccion } = await sb
        .from('training_lessons')
        .select('id')
        .eq('tenant_id', t.tenantId)
        .eq('id', body.lessonId)
        .maybeSingle()
      if (!leccion) return error('Lección no encontrada', 404)
      const { count } = await sb
        .from('training_resources')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', t.tenantId)
        .eq('lesson_id', body.lessonId)
      if ((count ?? 0) >= MAX_SOPS_POR_LECCION) return error(`Máximo ${MAX_SOPS_POR_LECCION} SOPs por lección.`)
      const { data, error: errBD } = await sb
        .from('training_resources')
        .insert({
          tenant_id: t.tenantId,
          lesson_id: body.lessonId,
          title: sop.titulo,
          url: sop.url,
          position: count ?? 0,
        })
        .select('id')
        .single()
      if (errBD) return fallaBD('crear_sop', errBD)
      return NextResponse.json({ ok: true, id: (data as { id: string }).id })
    }
    case 'editar_sop': {
      const sop = validarSop(body.url, body.title)
      if (!esUuid(body.id) || !sop.ok) return error(ERR_SOP)
      const { data, error: errBD } = await sb
        .from('training_resources')
        .update({ title: sop.titulo, url: sop.url })
        .eq('tenant_id', t.tenantId)
        .eq('id', body.id)
        .select('id')
      if (errBD) return fallaBD('editar_sop', errBD)
      if (!data?.length) return error('SOP no encontrado', 404)
      return NextResponse.json({ ok: true })
    }
    case 'borrar_sop': {
      if (!esUuid(body.id)) return error('Datos no válidos')
      const { data, error: errBD } = await sb
        .from('training_resources')
        .delete()
        .eq('tenant_id', t.tenantId)
        .eq('id', body.id)
        .select('id')
      if (errBD) return fallaBD('borrar_sop', errBD)
      if (!data?.length) return error('SOP no encontrado', 404)
      return NextResponse.json({ ok: true })
    }
    case 'curso_estandar': {
      // Idempotente de verdad: la clave `seed_key` es única por subcuenta en BD, así que dos clics o dos pestañas
      // a la vez no duplican y renombrar el curso no provoca que se vuelva a sembrar.
      const { data: curso, error: errCurso } = await sb
        .from('training_courses')
        .insert({
          tenant_id: t.tenantId,
          title: CURSO_ESTANDAR.title,
          description: CURSO_ESTANDAR.description,
          seed_key: SEED_ESTANDAR,
          audience_roles: ['affiliate'],
          position: await siguientePosicion('training_courses'),
          created_by: t.userId,
        })
        .select('id')
        .single()
      if (errCurso?.code === '23505') return NextResponse.json({ ok: true, creado: false })
      if (errCurso || !curso) return fallaBD('curso_estandar', errCurso ?? { message: 'sin fila' })
      const cursoId = (curso as { id: string }).id
      const { error: errLecciones } = await sb.from('training_lessons').insert(
        CURSO_ESTANDAR.lecciones.map((l, i) => ({
          tenant_id: t.tenantId,
          course_id: cursoId,
          title: l.title,
          description: l.description,
          position: i,
        }))
      )
      if (errLecciones) {
        // Sin lecciones el curso quedaría vacío y, al existir ya su clave, no se podría volver a sembrar: se deshace.
        const { error: errDeshacer } = await sb
          .from('training_courses')
          .delete()
          .eq('tenant_id', t.tenantId)
          .eq('id', cursoId)
        if (errDeshacer)
          console.error('[formacion] curso_estandar: no se pudo deshacer el curso vacío:', errDeshacer.message)
        return fallaBD('curso_estandar/lecciones', errLecciones)
      }
      return NextResponse.json({ ok: true, creado: true, id: cursoId })
    }
    default:
      return error('Acción no válida')
  }
}
