import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')

test('el menú móvil reutiliza Sheet para foco, Escape y retorno al disparador', () => {
  const sidebar = read('components/os/Sidebar.tsx')
  const header = read('components/os/Header.tsx')

  assert.match(sidebar, /<Sheet open=\{isOpen\}/)
  assert.match(sidebar, /<SheetContent[\s\S]*id="mobile-navigation"/)
  assert.match(sidebar, /<SheetTitle>Navegación<\/SheetTitle>/)
  assert.match(header, /aria-controls="mobile-navigation"/)
  assert.match(header, /aria-expanded=\{menuOpen\}/)
})

test('la navegación expone estado actual y secciones colapsables', () => {
  const sidebar = read('components/os/Sidebar.tsx')
  assert.match(sidebar, /aria-current=\{active \? 'page' : undefined\}/)
  assert.match(sidebar, /aria-expanded=\{!isCollapsed\}/)
  assert.match(sidebar, /aria-controls=\{sectionId\}/)
})

test('login anuncia errores y no filtra mensajes técnicos del proveedor', () => {
  const login = read('app/[tenant]/login/page.tsx')
  const messages = read('lib/auth/error-message.ts')

  assert.match(login, /role="alert"/)
  assert.match(login, /aria-live="assertive"/)
  assert.match(login, /authErrorMessage\(authError\)/)
  assert.match(messages, /invalid_credentials/)
  assert.match(messages, /No se pudo iniciar sesión/)
})

test('login no pide credenciales mientras todavía comprueba la subcuenta', () => {
  const login = read('app/[tenant]/login/page.tsx')
  const checking = login.indexOf("subcuenta === 'comprobando'")
  const unknown = login.indexOf("subcuenta === 'desconocida'")
  const form = login.indexOf('<form onSubmit={handleSubmit}')

  assert.ok(checking > -1 && unknown > checking && form > unknown)
  assert.match(login, /Comprobando subcuenta…/)
  assert.match(login, /role="status"[\s\S]{0,80}aria-live="polite"/)
})

test('layout y login comparten una sola petición de branding en vuelo', () => {
  const layout = read('app/[tenant]/layout.tsx')
  const login = read('app/[tenant]/login/page.tsx')
  const loader = read('lib/public-tenant-branding-client.ts')

  assert.match(layout, /loadPublicTenantBranding\(tenant\)/)
  assert.match(login, /loadPublicTenantBranding\(tenant\)/)
  assert.match(loader, /pendingBySlug\.get\(slug\)/)
  assert.match(loader, /pendingBySlug\.set\(slug, request\)/)
})

test('recuperación anuncia el éxito y usa un CTA con contraste reforzado', () => {
  const recover = read('app/[tenant]/recover/page.tsx')
  assert.match(recover, /role="status" aria-live="polite"/)
  assert.match(recover, /bg-brand-700 text-white hover:bg-brand-600/)
})
