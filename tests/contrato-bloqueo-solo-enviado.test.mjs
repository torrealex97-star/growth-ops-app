import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('la API solo marca bloqueaAcceso si hay un contrato ENVIADO con enlace y sin firmar', () => {
  const s = leer('app/api/[tenant]/evergreen/contracts/my-status/route.ts')
  assert.match(s, /c\.status === 'enviado' && c\.signing_token/)
  assert.match(s, /const bloqueaAcceso = !hasSigned && !!enviadoSinFirmar/)
  assert.match(s, /signingToken: enviadoSinFirmar\?\.signing_token \?\? null/)
})

test('el layout deja pasar a quien no tiene contrato enviado (firmó por otra vía)', () => {
  const s = leer('app/[tenant]/layout.tsx')
  assert.match(s, /res\.data\?\.bloqueaAcceso === true && res\.data\.signingToken/)
  // Ya no se bloquea por «hasSigned === false» a secas, que dejaba fuera a quien no consta en la app.
  assert.doesNotMatch(s, /res\.data\?\.hasSigned === false/)
  assert.doesNotMatch(s, /Aún no tienes ningún contrato asignado/)
})

test('un contrato enviado hace más de 7 días ya no bloquea: solo recuerda (caso firmado fuera de la app)', () => {
  const r = readFileSync(new URL('../app/api/[tenant]/evergreen/contracts/my-status/route.ts', import.meta.url), 'utf8')
  assert.match(r, /VENTANA_BLOQUEO_MS = 7 \* 24 \* 60 \* 60 \* 1000/)
  assert.match(r, /const bloqueaAcceso = !hasSigned && !!enviadoSinFirmar && dentroDeGracia/)
  assert.match(r, /const recordatorio = !hasSigned && !!enviadoSinFirmar && !bloqueaAcceso/)
  const l = readFileSync(new URL('../app/[tenant]/layout.tsx', import.meta.url), 'utf8')
  assert.match(l, /res\.data\?\.recordatorio === true/)
  assert.match(l, /Si ya lo firmaste por otra vía/)
})

test('un administrador puede dar un contrato por firmado fuera de la app, con auditoría', () => {
  const r = readFileSync(
    new URL('../app/api/[tenant]/evergreen/contracts/mark-external/route.ts', import.meta.url),
    'utf8'
  )
  assert.match(r, /ALLOWED_ROLES = new Set\(\['admin', 'director', 'manager'\]\)/)
  assert.match(r, /source: 'firmado_externamente'/)
  assert.match(r, /action: 'mark_signed_externally'/)
  assert.match(r, /\.eq\('tenant_id', t\.tenantId\)/)
  const p = readFileSync(new URL('../app/[tenant]/contratos/equipo/page.tsx', import.meta.url), 'utf8')
  assert.match(p, /mark-external/)
})
