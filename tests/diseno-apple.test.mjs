import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const css = readFileSync('app/globals.css', 'utf8')

test('los materiales translúcidos respetan prefers-reduced-transparency', () => {
  const bloque = css.slice(css.indexOf('@media (prefers-reduced-transparency: reduce)'))
  assert.match(bloque, /backdrop-filter: none !important/)
  assert.match(bloque, /header\[class\*='backdrop-blur'\]/)
})

test('prefers-contrast: more refuerza bordes y texto atenuado en claro y oscuro', () => {
  const bloque = css.slice(css.indexOf('@media (prefers-contrast: more)'))
  assert.match(bloque, /:root \{[^}]*--border/)
  assert.match(bloque, /\.dark \{[^}]*--muted-foreground/)
})

test('tracking por tamaño: titulares apretados, cuerpo sin tocar', () => {
  assert.match(css, /h1 \{\s*letter-spacing: -0\.02em/)
  assert.match(css, /h3 \{\s*letter-spacing: -0\.01em/)
  assert.doesNotMatch(css, /body \{[^}]*letter-spacing/)
})

test('el feedback de pulsación no pisa transform y respeta reduced-motion', () => {
  const i = css.indexOf("button:not(:disabled):not([role='tab']):active")
  assert.ok(i > 0)
  const bloque = css.slice(i, i + 120)
  assert.match(bloque, /scale: 0\.98/)
  assert.doesNotMatch(bloque, /transform:/)
  assert.match(css.slice(css.lastIndexOf('@media', i), i), /prefers-reduced-motion: no-preference/)
})
