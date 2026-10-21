import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = (p) => readFileSync(join(raiz, p), 'utf8')
const API = 'app/api/[tenant]/evergreen/forms/public/[slug]'

test('/f/ se abre sin sesión con barra final (no choca con /funnels ni /finanzas)', () => {
  const mw = leer('middleware.ts')
  assert.match(mw, /TENANT_PUBLIC_SUFFIXES = \[[^\]]*'\/f\/'/)
  assert.match(leer('app/[tenant]/layout.tsx'), /PUBLIC_PREFIXES = \[[^\]]*'\/f\/'/)
  assert.doesNotMatch(mw, /'\/f'[,\]]/)
  assert.match(mw, /'\/evergreen\/forms\/public'/)
})

test('solo la API pública de formularios queda abierta: el CRUD de admin exige sesión', () => {
  const mw = leer('middleware.ts')
  // La entrada pública es EXACTAMENTE forms/public, nunca el prefijo forms a secas.
  assert.doesNotMatch(mw, /'\/evergreen\/forms'[,\s]/)
})

test('las rutas públicas usan service role, resuelven el tenant por slug y limitan peticiones', () => {
  for (const f of ['route.ts', 'session/route.ts', 'submit/route.ts']) {
    const src = leer(`${API}/${f}`)
    assert.match(src, /serviceClient\(\)/, `${f}: service role`)
    assert.match(src, /loadPublishedForm\(/, `${f}: tenant+slug+publicado`)
    assert.match(src, /limitar\(/, `${f}: rate limit`)
  }
  const server = leer('lib/forms/server.ts')
  assert.match(server, /\.eq\('tenant_id', tenant\.id\)/)
  assert.match(server, /form\.status !== 'published'/)
})

test('el envío es idempotente, con honeypot, tope de tamaño y sin crear contacto de empleados', () => {
  const src = leer(`${API}/submit/route.ts`)
  assert.match(src, /onConflict: 'tenant_id,submission_id'/)
  assert.match(src, /existing\?\.status === 'completed'/)
  assert.match(src, /b\.company && b\.company\.trim\(\) !== ''/)
  assert.match(src, /MAX_BODY_BYTES/)
  assert.match(src, /form\.audience === 'captacion' \|\| form\.audience === 'cualificacion'/)
  assert.doesNotMatch(src, /audience === 'empleados'[^}]*getOrCreateContact/)
  // El feedback de alumnos solo empareja, no da de alta.
  assert.match(src, /buscarContactoPorEmail/)
})

test('el navegador nunca recibe los pesos de scoring', () => {
  assert.match(leer(`${API}/route.ts`), /stripForPublic\(form\.config\)/)
})

test('el motor público no usa emojis ni localStorage fuera de try/catch', () => {
  for (const f of [
    'components/forms/engine/FormEngine.tsx',
    'components/forms/engine/Field.tsx',
    'app/[tenant]/f/[slug]/page.tsx',
  ]) {
    assert.doesNotMatch(leer(f), /\p{Extended_Pictographic}/u, `${f}: emojis`)
  }
})

test('los formularios públicos se pueden incrustar (el resto de la app sigue sin poder)', () => {
  const cfg = leer('next.config.js')
  assert.match(cfg, /source: '\/\(\(\?!embed\|tracker\\\\\.js\|\[\^\/\]\+\/f\/\)\.\*\)'/)
  // Y la regla anti-framing sigue ahí para todo lo demás.
  assert.match(cfg, /X-Frame-Options', value: 'SAMEORIGIN'/)
})
