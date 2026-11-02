import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CATEGORIAS,
  ETAPAS,
  longitudValida,
  planDeSecuencia,
  seccionHistoriasPrompt,
} from '../lib/carruseles/historias/categorias.ts'
import { CSS_NATIVO, GUIA_COMPONENTES, ZONA_SEGURA, flechaSvg } from '../lib/carruseles/historias/estilo-nativo.ts'
import { wrapSlideHtml } from '../lib/carruseles/slide-html.ts'
import { buildSystemPrompt } from '../lib/carruseles/system-prompt.ts'

const marca = {
  name: 'Demo',
  colors: { primary: '#111111', secondary: '#222222', accent: '#c026d3', background: '#000000', surface: '#101010' },
  fonts: { heading: 'Inter', body: 'Inter' },
  logoUrl: null,
  styleKeywords: [],
}
const proyecto = (aspectRatio, kind = 'carousel') => ({
  id: 'p',
  title: 'T',
  kind,
  aspectRatio,
  slides: [],
  referenceImages: [],
  caption: null,
  hashtags: [],
  isTemplate: false,
  createdAt: '',
  updatedAt: '',
})

test('toda categoría tiene arco de 3, 5 y 7 con longitud exacta, empieza en gancho y termina en cta', () => {
  for (const c of Object.values(CATEGORIAS)) {
    for (const n of [3, 5, 7]) {
      const plan = planDeSecuencia(c.id, n)
      assert.equal(plan.length, n, `${c.id} n=${n}`)
      assert.equal(plan[0].etapa, 'gancho', `${c.id} n=${n} empieza en gancho`)
      assert.equal(plan[plan.length - 1].etapa, 'cta', `${c.id} n=${n} termina en cta`)
      assert.deepEqual(
        plan.map((p) => p.n),
        Array.from({ length: n }, (_, i) => i + 1)
      )
    }
  }
})

test('cada etapa define foto, velo, zona y componentes que existen en el CSS', () => {
  for (const [e, s] of Object.entries(ETAPAS)) {
    assert.ok(s.foto && s.objetivo && s.componentes.length, e)
    for (const comp of s.componentes)
      assert.match(CSS_NATIVO, new RegExp(`\\.${comp}\\b`), `${e}: falta .${comp} en el CSS`)
    assert.ok([0, 20, 40, 60, 75].includes(s.velo))
    assert.match(CSS_NATIVO, new RegExp(`\\.ig-velo-${s.velo}\\b`))
  }
  // El gancho y el cierre llevan la foto limpia; el desarrollo, más oscura.
  assert.ok(ETAPAS.gancho.velo <= 20 && ETAPAS.cta.velo <= 20)
  assert.ok(ETAPAS.cambio.velo >= 60 && ETAPAS.prueba.velo >= 60)
})

test('longitud válida redondea a 3/5/7 y por defecto 5; categoría o longitud inválidas lanzan', () => {
  assert.equal(longitudValida(undefined), 5)
  assert.equal(longitudValida(2), 3)
  assert.equal(longitudValida(4), 5)
  assert.equal(longitudValida(6), 7)
  assert.equal(longitudValida(12), 7)
  assert.throws(() => planDeSecuencia('inventada', 5), /desconocida/)
  assert.throws(() => planDeSecuencia('opinion_error', 4), /3, 5 o 7/)
})

test('todas las clases que documenta la guía de componentes están definidas en el CSS', () => {
  const clases = new Set([...GUIA_COMPONENTES.matchAll(/\b(ig-[a-z-]+)\b/g)].map((m) => m[1]))
  assert.ok(clases.size > 15)
  for (const c of clases) assert.match(CSS_NATIVO, new RegExp(`\\.${c}\\b`), `falta .${c}`)
})

test('el CSS nativo no usa degradados decorativos ni sombras de plantilla en el texto y respeta la zona segura', () => {
  const sinMarcador = CSS_NATIVO.replace(/\.ig-marcador\{[^}]*\}/, '')
  assert.doesNotMatch(sinMarcador, /linear-gradient|radial-gradient/)
  assert.doesNotMatch(CSS_NATIVO, /text-shadow/)
  assert.match(CSS_NATIVO, new RegExp(`top:${ZONA_SEGURA.arriba}px`))
  assert.match(CSS_NATIVO, new RegExp(`bottom:${ZONA_SEGURA.abajo}px`))
})

test('wrapSlideHtml inyecta el estilo nativo y sus fuentes SOLO en 9:16, con pesos válidos', () => {
  const h = wrapSlideHtml('<div class="ig-historia"></div>', '9:16')
  assert.match(h, /\.ig-caja-negra/)
  assert.match(h, /family=DM\+Serif\+Display&family=Anton/)
  assert.doesNotMatch(
    h,
    /DM\+Serif\+Display:wght/,
    'DM Serif Display solo existe en peso 400: pedir más pesos da 400 en Google Fonts'
  )
  assert.doesNotMatch(wrapSlideHtml('<div></div>', '4:5'), /ig-caja-negra|Space\+Mono/)
})

test('el prompt de un proyecto 9:16 usa el estilo nativo y excluye la «inteligencia de diseño» genérica', () => {
  const p = buildSystemPrompt(marca, proyecto('9:16'))
  assert.match(p, /HISTORIAS \(9:16\)/)
  assert.match(p, /ig-caja-negra/)
  assert.match(p, /--ig-acento:#c026d3/)
  assert.match(p, /opinion_error/)
  assert.doesNotMatch(p, /gradientes para dar profundidad/)
  assert.doesNotMatch(p, /VARIEDAD CREATIVA/)
  const carrusel = buildSystemPrompt(marca, proyecto('4:5'))
  assert.doesNotMatch(carrusel, /HISTORIAS \(9:16\)/)
  assert.match(carrusel, /gradientes para dar profundidad/)
  const flyer = buildSystemPrompt(marca, proyecto('9:16', 'flyer'))
  assert.doesNotMatch(flyer, /HISTORIAS \(9:16\)/, 'un flyer vertical no es una secuencia de historias')
})

test('la sección de historias prohíbe lo que delata un diseño externo y exige una palabra de acento', () => {
  const s = seccionHistoriasPrompt()
  assert.match(s, /NUNCA parezca un diseño externo/)
  assert.match(s, /UNA palabra de acento por historia/)
  assert.match(s, /no inventes fotos/)
  assert.match(s, /zona segura/i)
})

test('la flecha a mano es un SVG inline con rotación redondeada', () => {
  const f = flechaSvg(33.6)
  assert.match(f, /^<svg class="ig-flecha"/)
  assert.match(f, /rotate\(34deg\)/)
})

test('la etiqueta de fecha queda por encima de la zona de texto superior (no la tapa el titular)', () => {
  const m = CSS_NATIVO.match(/\.ig-etiqueta-fecha\{[^}]*top:(\d+)px/)
  assert.ok(m, 'la etiqueta de fecha tiene posición superior')
  // Alto aproximado de la etiqueta: 3 líneas de 26px con interlineado 1.1 + relleno.
  assert.ok(
    Number(m[1]) + 3 * 26 * 1.1 + 16 <= ZONA_SEGURA.arriba,
    'la etiqueta termina antes de donde empieza el texto'
  )
})

test('la guía obliga a envolver las cajas de texto en un div para que se ajusten línea a línea', () => {
  assert.match(GUIA_COMPONENTES, /Envuelve SIEMPRE la caja en su propio <div>/)
})
