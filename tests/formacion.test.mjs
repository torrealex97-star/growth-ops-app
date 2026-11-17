import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { allowedPrefixesFor, NAV_PAGES, ROLE_LABELS } from '@/lib/auth/permissions'
import { CURSO_ESTANDAR } from '@/lib/formacion/curso-estandar'
import { cursoVisibleParaRol, ordenarLecciones, resumenProgreso, siguientePendiente } from '@/lib/formacion/progreso'
import { MAX_SOPS_POR_LECCION, validarSop } from '@/lib/formacion/recurso'
import { parsearVideo } from '@/lib/formacion/video'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (s) => s.replace(/^\s*\/\/[^\n]*/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
const sinComentariosSql = (s) => s.replace(/--[^\n]*/g, '')

// ---------------------------------------------------------------- vídeo: lista blanca y URL canónica
test('parsearVideo: acepta los proveedores permitidos y reescribe a la URL embebible canónica', () => {
  assert.deepEqual(parsearVideo('https://www.loom.com/share/abc123DEF456abc123DEF456abc12345'), {
    proveedor: 'loom',
    embedUrl: 'https://www.loom.com/embed/abc123DEF456abc123DEF456abc12345',
  })
  assert.equal(
    parsearVideo('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s')?.embedUrl,
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
  )
  assert.equal(
    parsearVideo('https://youtu.be/dQw4w9WgXcQ?si=x')?.embedUrl,
    'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'
  )
  assert.equal(parsearVideo('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.proveedor, 'youtube')
  assert.equal(parsearVideo('https://vimeo.com/123456789')?.embedUrl, 'https://player.vimeo.com/video/123456789')
  assert.equal(
    parsearVideo('https://miempresa.wistia.com/medias/abcd1234ef')?.embedUrl,
    'https://fast.wistia.net/embed/iframe/abcd1234ef'
  )
  assert.equal(
    parsearVideo('https://iframe.mediadelivery.net/play/12345/0a1b2c3d-1111-2222-3333-444455556666')?.embedUrl,
    'https://iframe.mediadelivery.net/embed/12345/0a1b2c3d-1111-2222-3333-444455556666'
  )
})

test('parsearVideo: Vimeo no listado conserva su hash (sin él el reproductor da error de privacidad)', () => {
  assert.equal(
    parsearVideo('https://vimeo.com/123456789/abcdef1234')?.embedUrl,
    'https://player.vimeo.com/video/123456789?h=abcdef1234'
  )
  assert.equal(
    parsearVideo('https://vimeo.com/123456789?h=abcdef1234')?.embedUrl,
    'https://player.vimeo.com/video/123456789?h=abcdef1234'
  )
  assert.equal(
    parsearVideo('https://player.vimeo.com/video/123456789?h=abcdef1234&autoplay=1')?.embedUrl,
    'https://player.vimeo.com/video/123456789?h=abcdef1234'
  )
  assert.equal(parsearVideo('https://vimeo.com/123456789')?.embedUrl, 'https://player.vimeo.com/video/123456789')
  assert.equal(parsearVideo('https://vimeo.com/123456789/zz<script>'), null, 'hash no hexadecimal')
})

test('parsearVideo: rechaza esquemas peligrosos, hosts ajenos, parecidos y credenciales', () => {
  const malos = [
    '',
    'no es una url',
    'http://www.loom.com/share/abc123DEF456',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'https://evil.com/share/abc123DEF456',
    'https://loom.com.evil.com/share/abc123DEF456',
    'https://evilloom.com/share/abc123DEF456',
    'https://youtube.evil.com/watch?v=dQw4w9WgXcQ',
    'https://user:pass@www.loom.com/share/abc123DEF456',
    'https://www.loom.com/share/',
    'https://www.loom.com/share/../../etc',
    'https://www.youtube.com/watch?v=<script>',
    'https://vimeo.com/notnumeric',
    'https://iframe.mediadelivery.net/embed/abc/xyz',
    `https://www.loom.com/share/${'a'.repeat(700)}`,
  ]
  for (const m of malos) assert.equal(parsearVideo(m), null, `debía rechazar: ${m.slice(0, 60)}`)
})

test('parsearVideo: nunca devuelve la cadena del usuario tal cual (siempre reconstruida)', () => {
  const v = parsearVideo('https://www.loom.com/share/abc123DEF456?onlyEmbed=<x>&autoplay=1#frag')
  assert.equal(v?.embedUrl, 'https://www.loom.com/embed/abc123DEF456')
})

// ---------------------------------------------------------------- SOPs (enlaces a documentos)
test('validarSop: nombre y enlace https obligatorios, sin credenciales', () => {
  const ok = validarSop('https://docs.google.com/document/d/abc/edit', ' SOP de agendamiento ')
  assert.deepEqual(ok, { ok: true, url: 'https://docs.google.com/document/d/abc/edit', titulo: 'SOP de agendamiento' })
  for (const [url, titulo] of [
    ['http://x.com/a', 'x'],
    ['javascript:alert(1)', 'x'],
    ['https://u:p@x.com/a', 'x'],
    ['ftp://x.com/a', 'x'],
    ['no url', 'x'],
    ['https://x.com/a', ''],
    ['https://x.com/a', '   '],
    ['https://x.com/a', 'a'.repeat(121)],
    ['https://x.com/a', 42],
    [42, 'x'],
    [undefined, undefined],
  ]) {
    assert.equal(validarSop(url, titulo).ok, false, `${String(url)} / ${String(titulo)}`)
  }
  assert.equal(MAX_SOPS_POR_LECCION, 10)
})

// ---------------------------------------------------------------- progreso
test('resumenProgreso: cuenta solo lecciones existentes, nunca pasa de 100 % ni da NaN', () => {
  const lecs = [
    { id: 'a', course_id: 'c1' },
    { id: 'b', course_id: 'c1' },
    { id: 'c', course_id: 'c2' },
  ]
  const r = resumenProgreso(lecs, ['a', 'c', 'borrada', 'ajena'])
  assert.equal(r.total, 3)
  assert.equal(r.hechas, 2)
  assert.equal(r.porcentaje, 67)
  assert.deepEqual(r.porCurso, { c1: { total: 2, hechas: 1 }, c2: { total: 1, hechas: 1 } })
  assert.equal(resumenProgreso([], ['x']).porcentaje, 0)
  assert.equal(resumenProgreso(lecs, ['a', 'b', 'c']).porcentaje, 100)
})

test('siguientePendiente: la primera sin completar en el orden dado; null si todo hecho', () => {
  const lecs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.equal(siguientePendiente(lecs, ['a'])?.id, 'b')
  assert.equal(siguientePendiente(lecs, [])?.id, 'a')
  assert.equal(siguientePendiente(lecs, ['a', 'b', 'c']), null)
})

test('ordenarLecciones: por curso y posición, con desempate estable por id (la pantalla y la tarjeta coinciden)', () => {
  const cursos = [{ id: 'c2' }, { id: 'c1' }]
  const lecs = [
    { id: 'z', course_id: 'c1', position: 0 },
    { id: 'b', course_id: 'c2', position: 1 },
    { id: 'a', course_id: 'c2', position: 1 },
    { id: 'x', course_id: 'c2', position: 0 },
    { id: 'huerfana', course_id: 'borrado', position: 0 },
  ]
  assert.deepEqual(
    ordenarLecciones(cursos, lecs).map((l) => l.id),
    ['x', 'a', 'b', 'z', 'huerfana']
  )
  // No muta la entrada.
  assert.equal(lecs[0].id, 'z')
})

test('cursoVisibleParaRol: sin público lo ve todo el equipo; con público, solo esos roles', () => {
  assert.equal(cursoVisibleParaRol(null, 'closer'), true)
  assert.equal(cursoVisibleParaRol([], 'closer'), true)
  assert.equal(cursoVisibleParaRol(['affiliate'], 'affiliate'), true)
  assert.equal(cursoVisibleParaRol(['affiliate'], 'closer'), false)
  assert.equal(cursoVisibleParaRol(['affiliate'], null), false)
})

// ---------------------------------------------------------------- curso estándar
test('curso estándar: genérico (sin vídeos, sin marcas ni personas) y con lecciones útiles', () => {
  assert.ok(CURSO_ESTANDAR.lecciones.length >= 5)
  const todo = JSON.stringify(CURSO_ESTANDAR)
  assert.doesNotMatch(
    todo,
    /https?:\/\//i,
    'el contenido de cada subcuenta (vídeos, manuales) se añade como dato, no en el repo'
  )
  assert.doesNotMatch(todo, /loom|youtube|wistia|google/i)
})

// ---------------------------------------------------------------- migración: aislamiento entre subcuentas
test('migración: tenant_id en todo, FK compuestas, RLS activada y política restrictiva por subcuenta', () => {
  const sql = sinComentariosSql(leer('supabase/migrations/20261116120000_formacion_colaboradoras.sql'))
  for (const t of ['training_courses', 'training_lessons', 'training_progress']) {
    const bloque = sql.slice(sql.indexOf(`CREATE TABLE IF NOT EXISTS public.${t}`))
    assert.match(
      bloque.slice(0, 900),
      /tenant_id\s+UUID NOT NULL REFERENCES public\.tenants/,
      `${t} sin tenant_id NOT NULL`
    )
    assert.ok(sql.includes(`'${t}'`), `${t} sin RLS/política en el bloque DO`)
  }
  // Una lección no puede colgar de un curso de OTRA subcuenta, ni un progreso apuntar a una lección ajena.
  assert.match(sql, /FOREIGN KEY \(tenant_id, course_id\) REFERENCES public\.training_courses \(tenant_id, id\)/)
  assert.match(sql, /FOREIGN KEY \(tenant_id, lesson_id\) REFERENCES public\.training_lessons \(tenant_id, id\)/)
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON public\.%I FROM anon, authenticated/)
  assert.match(sql, /AS RESTRICTIVE FOR ALL/)
  assert.match(sql, /\(SELECT public\.is_super_admin\(\)\)/, 'InitPlan: is_super_admin dentro de (select …)')
  assert.match(sql, /tenant_id IN \(SELECT public\.auth_tenant_ids\(\)\)/)
  // El progreso es por persona: la clave incluye user_id.
  assert.match(sql, /PRIMARY KEY \(user_id, lesson_id\)/)
  // Enlaces externos: solo https.
  assert.match(sql, /resource_url ~ '\^https:\/\/'/)
  // Curso sembrado único por subcuenta aunque se renombre o se pulse dos veces; público por rol acotado.
  assert.match(sql, /seed_key\s+TEXT CHECK/)
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS training_courses_seed_key_uidx ON public\.training_courses \(tenant_id, seed_key\) WHERE seed_key IS NOT NULL/
  )
  assert.match(sql, /audience_roles TEXT\[\] CHECK/)
  // Defensa en profundidad: el iframe solo puede apuntar a un embed canónico de la lista blanca, también en BD.
  assert.match(sql, /video_url ~/)
  for (const host of ['youtube-nocookie', 'loom', 'wistia', 'vimeo', 'mediadelivery'])
    assert.match(sql, new RegExp(host))
  // FK created_by con índice (advisor unindexed_foreign_keys).
  assert.match(sql, /training_courses_created_by_idx ON public\.training_courses \(created_by\)/)
  // Sin DROP ni cambios destructivos sobre tablas existentes.
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i)
  // Marcada como NO aplicada hasta confirmación expresa.
  assert.match(leer('supabase/migrations/20261116120000_formacion_colaboradoras.sql'), /ESTADO: NO APLICADA/)
})

// ---------------------------------------------------------------- API: autorización y tenant explícito
test('API formación: pantalla exigida, escritura solo para quien administra, tenant_id en cada consulta', () => {
  const api = sinComentarios(leer('app/api/[tenant]/evergreen/formacion/route.ts'))
  const prog = sinComentarios(leer('app/api/[tenant]/evergreen/formacion/progreso/route.ts'))
  for (const src of [api, prog]) {
    assert.match(src, /requirePantalla\(tenant, '\/formacion'\)/)
    assert.doesNotMatch(src, /select\('\*'\)/, 'sin select(*)')
  }
  // POST (escritura de contenido) exige administrar ESTA subcuenta.
  const post = api.slice(api.indexOf('export async function POST'))
  assert.match(post, /!t\.administraTenant/)
  // Cada acceso a una tabla de formación filtra por tenant (service-role: es la única barrera).
  for (const src of [api, prog]) {
    const consultas = src.split(/\.from\('training_/).slice(1)
    assert.ok(consultas.length > 0)
    for (const c of consultas) {
      const tramo = c.slice(0, 700)
      const esInsert = /^\w+'\)\s*\.(insert|upsert)\(/.test(tramo)
      assert.ok(
        esInsert ? /tenant_id: t\.tenantId/.test(tramo) : /\.eq\('tenant_id', t\.tenantId\)/.test(tramo),
        `consulta sin tenant: ${tramo.slice(0, 80)}`
      )
    }
  }
  // El progreso es de QUIEN LLAMA: el user_id sale de la sesión, nunca del cuerpo.
  assert.match(prog, /user_id: t\.userId/)
  assert.doesNotMatch(prog, /body\.userId|body\.user_id/)
  // Escribir sobre algo que no existe (borrado por otro admin, de otra subcuenta) da 404, no un «Guardado» falso.
  for (const accion of ['editar_curso', 'borrar_curso', 'editar_leccion', 'borrar_leccion']) {
    const bloque = post.slice(
      post.indexOf(`case '${accion}'`),
      post.indexOf('case ', post.indexOf(`case '${accion}'`) + 10)
    )
    assert.match(bloque, /\.select\('id'\)/, `${accion} debe comprobar que afectó a una fila`)
    assert.match(bloque, /404/, `${accion} debe devolver 404 si no hay fila`)
  }
  // Curso estándar idempotente por clave única (no por título): una carrera no lo duplica.
  assert.match(api, /seed_key: SEED_ESTANDAR/)
  assert.match(api, /errCurso\?\.code === '23505'/)
  // Público por rol: el rol sale de la sesión, solo roles que existen, y el filtro es por BD.
  assert.match(api, /ROLES_VALIDOS\.has\(r\)/)
  assert.match(api, /audience_roles\.is\.null,audience_roles\.cs\./)
  assert.match(api, /\/\^\[a-z_\]\+\$\/\.test\(t\.role\)/)
  // Modo ligero para la tarjeta y orden determinista (desempate por fecha e id).
  assert.match(api, /searchParams\.get\('resumen'\) === '1'/)
  assert.match(api, /\.order\('id', \{ ascending: true \}\)/)
  // Los listados están acotados.
  assert.match(api, /\.limit\(MAX_CURSOS\)/)
  assert.match(api, /\.limit\(MAX_LECCIONES\)/)
})

// ---------------------------------------------------------------- permisos y menú
test('permisos: /formacion es universal, con o sin permisos a medida', () => {
  for (const rol of Object.keys(ROLE_LABELS)) {
    const base = allowedPrefixesFor(rol, null, null)
    assert.ok(base === undefined || base.includes('/formacion'), `${rol}: sin acceso a /formacion por rol`)
    assert.ok(
      allowedPrefixesFor(rol, null, ['/crm/contactos'])?.includes('/formacion'),
      `${rol}: pierde /formacion con page_overrides`
    )
    assert.ok(
      allowedPrefixesFor(rol, ['marketing'], null)?.includes('/formacion'),
      `${rol}: pierde /formacion con dept_overrides`
    )
  }
  // Y por eso no aparece en el selector de páginas a medida (no se puede apagar por persona).
  assert.ok(!NAV_PAGES.some((p) => p.href === '/formacion'))
  const nav = leer('lib/nav.ts')
  assert.match(nav, /label: 'Formación', href: '\/formacion'.*roles: TODOS_LOS_ROLES/)
  assert.match(nav, /TODOS_LOS_ROLES = Object\.keys\(ROLE_LABELS\)/)
})

test('onboarding: el dashboard de la colaboradora enseña «Empieza aquí» y no rompe si no hay formación', () => {
  const dash = leer('components/collaborators/ColaboradorDashboard.tsx')
  assert.match(dash, /<EmpiezaAqui \/>/)
  const card = leer('components/formacion/EmpiezaAqui.tsx')
  assert.match(card, /if \(!resumen \|\| resumen\.total === 0\) return null/)
  assert.match(card, /ac\.abort\(\)/, 'cancela la petición al desmontar')
  assert.match(card, /formacion\?resumen=1/, 'la tarjeta usa el modo ligero')
  assert.match(card, /ordenarLecciones\(/, 'mismo orden que la pantalla')
  // La ven todos los perfiles: también el dashboard del resto del equipo.
  assert.match(leer('app/[tenant]/dashboard/page.tsx'), /<EmpiezaAqui \/>/)
})

// ---------------------------------------------------------------- regresiones del code review final
test('parsearVideo es idempotente: la URL canónica que guarda la API vuelve a reconocerse (la página la revalida)', () => {
  const entradas = [
    'https://www.loom.com/share/6f3c89c41c7d4737a41ab6027706cf42',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://vimeo.com/123456789/abcdef1234',
    'https://miempresa.wistia.com/medias/abcd1234ef',
    'https://iframe.mediadelivery.net/play/12345/0a1b2c3d-1111-2222-3333-444455556666',
  ]
  for (const entrada of entradas) {
    const guardada = parsearVideo(entrada)
    assert.ok(guardada, entrada)
    // Si esto falla, la API guarda el vídeo pero la página no pinta el iframe («vídeo no disponible»).
    assert.deepEqual(parsearVideo(guardada.embedUrl), guardada, `no idempotente: ${guardada.embedUrl}`)
  }
})

test('permisos: las pantallas universales van al FINAL, así zones[0] (destino de la redirección del layout) no cambia', () => {
  // Con permisos a medida por página: manda la primera página elegida.
  assert.equal(allowedPrefixesFor('marketing', null, ['/crm/contactos', '/ventas/pagos'])?.[0], '/crm/contactos')
  // Con departamentos: el primero sigue siendo el inicio personal o el primer prefijo del departamento.
  assert.equal(allowedPrefixesFor('closer', ['ventas'], null)?.[0], '/dashboard')
  assert.notEqual(allowedPrefixesFor('marketing', ['marketing'], null)?.[0], '/formacion')
  // Por rol: el primero no cambia y /formacion es siempre el último.
  for (const rol of Object.keys(ROLE_LABELS)) {
    const zonas = allowedPrefixesFor(rol, null, null)
    if (!zonas) continue
    assert.equal(zonas.at(-1), '/formacion', `${rol}: /formacion debe ir al final`)
    assert.notEqual(zonas[0], '/formacion', `${rol}: zones[0] no puede ser /formacion`)
  }
})

test('API formación: editar un curso sin audienceRoles NO cambia su público, y sin cursos visibles hay una sola consulta', () => {
  const api = sinComentarios(leer('app/api/[tenant]/evergreen/formacion/route.ts'))
  assert.match(api, /'audienceRoles' in body \? publicoDe\(body\.audienceRoles\) : undefined/)
  assert.match(api, /publico !== undefined \? \{ audience_roles: publico \} : \{\}/)
  // Retorno anticipado antes de consultar lecciones y progreso.
  const pos = (re) => api.search(re)
  assert.ok(pos(/idsCursos\.length === 0/) > -1 && pos(/idsCursos\.length === 0/) < pos(/from\('training_lessons'\)/))
  // La página sigue la URL (?leccion=) si cambia con el componente ya montado.
  assert.match(leer('app/[tenant]/formacion/page.tsx'), /leccionDeUrl/)
})

// ---------------------------------------------------------------- SOPs: varios por lección y también en Biblioteca
test('migración SOPs: tabla con tenant, FK compuesta, https obligatorio, RLS restrictiva y copia no destructiva', () => {
  const crudo = leer('supabase/migrations/20261117100000_formacion_sops.sql')
  const sql = sinComentariosSql(crudo)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.training_resources/)
  assert.match(sql, /tenant_id\s+UUID NOT NULL REFERENCES public\.tenants/)
  // Un SOP no puede colgar de una lección de OTRA subcuenta.
  assert.match(
    sql,
    /FOREIGN KEY \(tenant_id, lesson_id\) REFERENCES public\.training_lessons \(tenant_id, id\) ON DELETE CASCADE/
  )
  assert.match(sql, /url ~ '\^https:\/\/'/)
  assert.match(sql, /char_length\(title\) BETWEEN 1 AND 120/)
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON public\.training_resources FROM anon, authenticated/)
  assert.match(sql, /AS RESTRICTIVE FOR ALL/)
  assert.match(sql, /\(SELECT public\.is_super_admin\(\)\)/)
  assert.match(
    sql,
    /training_resources_lesson_pos_idx ON public\.training_resources \(tenant_id, lesson_id, position\)/
  )
  // Copia lo que había y es idempotente; no borra nada.
  assert.match(sql, /INSERT INTO public\.training_resources[\s\S]*FROM public\.training_lessons l[\s\S]*NOT EXISTS/)
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/i)
  assert.match(crudo, /ESTADO: NO APLICADA/)
})

test('API SOPs: crear/editar/borrar con tenant explícito, 404 sin fila, máximo por lección y solo administradores', () => {
  const api = sinComentarios(leer('app/api/[tenant]/evergreen/formacion/route.ts'))
  const post = api.slice(api.indexOf('export async function POST'))
  assert.match(post, /!t\.administraTenant/)
  for (const accion of ['crear_sop', 'editar_sop', 'borrar_sop']) assert.match(post, new RegExp(`case '${accion}'`))
  const bloque = (accion) =>
    post.slice(post.indexOf(`case '${accion}'`), post.indexOf('case ', post.indexOf(`case '${accion}'`) + 10))
  for (const accion of ['editar_sop', 'borrar_sop']) {
    assert.match(bloque(accion), /\.select\('id'\)/, `${accion} comprueba que afectó a una fila`)
    assert.match(bloque(accion), /404/)
    assert.match(bloque(accion), /\.eq\('tenant_id', t\.tenantId\)/)
  }
  const crear = bloque('crear_sop')
  assert.match(crear, /validarSop\(body\.url, body\.title\)/)
  assert.match(crear, /MAX_SOPS_POR_LECCION/)
  assert.match(crear, /tenant_id: t\.tenantId/)
  // La lección debe ser de ESTA subcuenta antes de adjuntar nada.
  assert.match(crear, /from\('training_lessons'\)[\s\S]*\.eq\('tenant_id', t\.tenantId\)/)
  // El GET sirve los SOPs filtrados por tenant y solo de las lecciones visibles; el modo ligero no los pide.
  assert.match(api, /from\('training_resources'\)[\s\S]*\.eq\('tenant_id', t\.tenantId\)/)
  assert.match(api, /idsLecciones\.has\(r\.lesson_id\)/)
  // Sin `.in()` con cientos de ids (revienta el límite de longitud de la URL de PostgREST).
  assert.doesNotMatch(api, /\.in\('lesson_id'/)
  assert.match(api, /!resumen && idsLecciones\.size > 0/)
  // Ya no hay recurso único en lecciones.
  assert.doesNotMatch(api, /resourceUrl|resource_url|resource_label|validarRecurso/)
})

test('UI SOPs: bajo el vídeo en Formación y en la pestaña SOPs de Recursos › Biblioteca, sin módulo duplicado', () => {
  const page = leer('app/[tenant]/formacion/page.tsx')
  assert.match(page, /<SopsLista/)
  assert.match(page, /action: 'crear_sop'/)
  assert.match(page, /action: 'borrar_sop'/)
  assert.doesNotMatch(page, /resourceUrl|resource_url/)
  const lista = leer('components/formacion/SopsLista.tsx')
  assert.match(lista, /rel="noopener noreferrer"/)
  assert.match(lista, /target="_blank"/)
  const bib = leer('app/[tenant]/recursos/biblioteca/page.tsx')
  assert.match(bib, /'calls' \| 'roleplays' \| 'sops'/)
  assert.match(bib, /<BibliotecaSops \/>/)
  // La pestaña no guarda nada propio: lee de la misma API de Formación (un solo origen de datos).
  const tab = leer('components/formacion/BibliotecaSops.tsx')
  assert.match(tab, /\/evergreen\/formacion`/)
  assert.doesNotMatch(tab, /method: 'POST'|\.insert\(|\.delete\(/)
  assert.match(tab, /ac\.abort\(\)/)
})
