import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

// Revisión de accesibilidad 27-oct (WCAG 2.2 AA): estáticos, porque lo que se protege es el marcado.
const leer = (p) => readFileSync(p, 'utf8')

test('VSL público: el botón central tiene nombre y el vídeo se puede pausar con teclado', () => {
  const v = leer('components/vsl/VslPlayer.tsx')
  assert.match(v, /aria-label="Reproducir"/)
  assert.match(v, /tabIndex=\{0\}[\s\S]{0,200}role="button"/)
  assert.match(v, /e\.key === 'Enter' \|\| e\.key === ' '/)
})

test('firma pública: cada campo tiene su <label htmlFor>, y el error se anuncia', () => {
  for (const f of ['app/firmar/[token]/page.tsx', 'app/firmar-alumno/[token]/page.tsx']) {
    const s = leer(f)
    assert.match(s, /htmlFor="firma-nombre"/, f)
    assert.match(s, /id="firma-nombre"/, f)
    assert.match(s, /htmlFor=\{`firma-\$\{f\.key\}`\}/, f)
    assert.match(s, /id=\{`firma-\$\{f\.key\}`\}/, f)
    assert.match(s, /role="alert"/, f)
  }
})

test('/firmar: textos pequeños con contraste suficiente sobre blanco (zinc-500 / amber-700, no zinc-400 / amber-600)', () => {
  const s = leer('app/firmar/[token]/page.tsx')
  assert.doesNotMatch(s, /mt-3 text-xs text-zinc-400 text-center|text-xs text-amber-600/)
})

test('formularios públicos: el nombre accesible contiene el texto visible y «Otro» queda asociado a su pregunta', () => {
  assert.doesNotMatch(leer('components/forms/engine/FormEngine.tsx'), /aria-label="Volver"/)
  const f = leer('components/forms/engine/Field.tsx')
  assert.equal((f.match(/aria-label=\{`\$\{q\.title\}: otra respuesta`\}/g) ?? []).length, 2)
})

test('conversaciones: pestañas con patrón ARIA completo y borrado de respuestas rápidas con confirmación', () => {
  const p = leer('app/[tenant]/conversaciones/page.tsx')
  assert.match(p, /role="tabpanel"/)
  assert.match(p, /aria-controls="conv-panel"/)
  assert.match(p, /e\.key === 'ArrowRight'/)
  assert.match(p, /tabIndex=\{activa === t \? 0 : -1\}/)
  assert.match(leer('app/[tenant]/conversaciones/BandejaTab.tsx'), /window\.confirm\(/)
  const e = leer('app/[tenant]/conversaciones/EntrenamientoTab.tsx')
  for (const n of ['Modelo de IA', 'Mensaje como el lead', '¿Qué mejorar\\? \\(regla\\)'])
    assert.match(e, new RegExp(`aria-label="${n}"`))
})

test('MultiSelect: el estado de cada opción se anuncia', () => {
  assert.match(leer('components/ui/multi-select.tsx'), /aria-pressed=\{active\}/)
})
