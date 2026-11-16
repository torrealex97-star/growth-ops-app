import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { allowedPrefixesFor } from '@/lib/auth/permissions'
import { CURSO_ESTANDAR } from '@/lib/formacion/curso-estandar'
import { resumenProgreso, siguientePendiente } from '@/lib/formacion/progreso'
import { validarRecurso } from '@/lib/formacion/recurso'
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

// ---------------------------------------------------------------- recurso
test('validarRecurso: solo https, sin credenciales; vacío es válido (sin recurso)', () => {
  assert.deepEqual(validarRecurso('', ''), { ok: true, url: null, etiqueta: null })
  assert.deepEqual(validarRecurso(undefined, undefined), { ok: true, url: null, etiqueta: null })
  const ok = validarRecurso('https://docs.google.com/document/d/abc/edit', ' Abrir el manual ')
  assert.equal(ok.ok, true)
  assert.equal(ok.etiqueta, 'Abrir el manual')
  for (const mal of ['http://x.com/a', 'javascript:alert(1)', 'https://u:p@x.com/a', 'ftp://x.com/a', 'no url', 42]) {
    assert.equal(validarRecurso(mal, null).ok, false, String(mal))
  }
  assert.equal(validarRecurso('https://x.com/a', 'a'.repeat(81)).ok, false)
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
  // Los listados están acotados.
  assert.match(api, /\.limit\(MAX_CURSOS\)/)
  assert.match(api, /\.limit\(MAX_LECCIONES\)/)
})

// ---------------------------------------------------------------- permisos y menú
test('permisos: la colaboradora ve /formacion, y una persona de cualquier otro rol sin acceso al área no', () => {
  const colab = allowedPrefixesFor('affiliate', null, null)
  assert.ok(colab?.includes('/formacion'), 'affiliate debe poder entrar a /formacion')
  // Con restricción por páginas, /formacion se puede conceder o quitar como cualquier otra.
  const sinFormacion = allowedPrefixesFor('affiliate', null, ['/dashboard'])
  assert.ok(!sinFormacion?.includes('/formacion'))
  const nav = leer('lib/nav.ts')
  assert.match(nav, /label: 'Formación', href: '\/formacion'.*roles: \[\.\.\.LEAD, 'affiliate'\]/)
  const permisos = leer('lib/auth/permissions.ts')
  assert.match(permisos, /\{ href: '\/formacion', label: 'Formación', dept: 'ventas' \}/)
})

test('onboarding: el dashboard de la colaboradora enseña «Empieza aquí» y no rompe si no hay formación', () => {
  const dash = leer('components/collaborators/ColaboradorDashboard.tsx')
  assert.match(dash, /<EmpiezaAqui \/>/)
  const card = leer('components/formacion/EmpiezaAqui.tsx')
  assert.match(card, /if \(!resumen \|\| resumen\.total === 0\) return null/)
  assert.match(card, /ac\.abort\(\)/, 'cancela la petición al desmontar')
})
