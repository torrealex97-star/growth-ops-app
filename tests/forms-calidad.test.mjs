import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = (p) => readFileSync(join(raiz, p), 'utf8')
const PUB = 'app/api/[tenant]/evergreen/forms/public/[slug]'

test('los parámetros de la URL se sanean, nunca tumban un envío ni una sesión', () => {
  const sub = leer(`${PUB}/submit/route.ts`)
  assert.match(sub, /hidden: z\.record\(z\.string\(\), z\.unknown\(\)\)\.optional\(\)/)
  assert.match(sub, /sanitizeHidden\(b\.hidden\)/)
  assert.match(sub, /HIDDEN_KEY = \/\^\[a-zA-Z0-9_\]\{1,40\}\$\//)
  const ses = leer(`${PUB}/session/route.ts`)
  assert.match(ses, /utm: z\.record\(z\.string\(\), z\.unknown\(\)\)\.optional\(\)/)
  assert.match(ses, /cleanUtm\(s\.utm\)/)
  assert.match(ses, /cleanTimes\(s\.questionTimes\)/)
})

test('el motor aplica el tema del formulario sobre el branding de la subcuenta, sin depender del ancestro', () => {
  const e = leer('components/forms/engine/FormEngine.tsx')
  assert.match(e, /formVars\(theme, prefersDark\)/)
  assert.match(e, /--form-on-accent/)
  assert.match(e, /var\(--form-button-radius/)
  assert.match(e, /brand\?: \{ name: string; logoUrl: string \| null \}/)
  assert.match(e, /min-h-\[100dvh\]/)
  const f = leer('components/forms/engine/Field.tsx')
  assert.match(f, /rounded-\[var\(--form-radius/)
  assert.doesNotMatch(f, /text-white/)
})

test('la página pública pasa el logo de la subcuenta y no enseña el nombre por defecto de la plataforma', () => {
  const p = leer('app/[tenant]/f/[slug]/page.tsx')
  assert.match(p, /useTenantBranding\(\)/)
  assert.match(p, /DEFAULT_BRAND_NAME \? ''/)
  assert.match(leer('lib/tenant-branding.ts'), /export const DEFAULT_BRAND_NAME/)
})

test('constructor: secciones por pestañas en pantallas pequeñas, vista previa enfocada y panel de diseño', () => {
  const b = leer('components/forms/builder/Builder.tsx')
  assert.match(b, /role="tablist"/)
  assert.match(b, /lg:hidden/)
  assert.match(b, /focusId=\{sel\.kind === 'question'/)
  assert.match(b, /focusEndingId=/)
  assert.match(b, /kind: 'design'/)
  assert.match(b, /exportJson/)
  assert.match(b, /importJson/)
  assert.match(leer('components/forms/builder/Panels.tsx'), /export function ThemePanel/)
})

test('duplicar copia solo el borrador del propio tenant; eliminar es solo admin/director', () => {
  const r = leer('app/api/[tenant]/evergreen/forms/route.ts')
  assert.match(r, /cloneFrom/)
  assert.match(r, /eq\('tenant_id', auth\.tenantId\)[\s\S]*?eq\('id', b\.cloneFrom\)/)
  const d = leer('app/api/[tenant]/evergreen/forms/[id]/route.ts')
  assert.match(d, /export async function DELETE/)
  assert.match(d, /Solo administración puede eliminar formularios/)
})

test('el motor y el constructor no usan emojis (páginas públicas: solo iconos lucide)', () => {
  for (const f of [
    'components/forms/engine/FormEngine.tsx',
    'components/forms/engine/Field.tsx',
    'components/forms/builder/Panels.tsx',
  ]) {
    assert.doesNotMatch(leer(f), /\p{Extended_Pictographic}/u, f)
  }
})
