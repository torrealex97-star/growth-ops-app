import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { LONGITUDES, MAX_TEMA, OPCIONES_CATEGORIA, mensajeInicial } from '../lib/carruseles/historias/briefing.ts'
import { CATEGORIAS } from '../lib/carruseles/historias/categorias.ts'
import { claveEncargo } from '../lib/carruseles/historias/encargo.ts'
import { buildSystemPrompt } from '../lib/carruseles/system-prompt.ts'

const marca = {
  name: 'Demo',
  colors: { primary: '#111111', secondary: '#222222', accent: '#c026d3', background: '#000000', surface: '#101010' },
  fonts: { heading: 'Inter', body: 'Inter' },
  logoUrl: null,
  styleKeywords: [],
}
const proyecto = (aspectRatio, referenceImages = []) => ({
  id: 'p',
  title: 'T',
  kind: 'carousel',
  aspectRatio,
  slides: [],
  referenceImages,
  caption: null,
  hashtags: [],
  isTemplate: false,
  createdAt: '',
  updatedAt: '',
})

test('el encargo incluye longitud normalizada, categoría y tema; sin tema pide proponerlo', () => {
  const m = mensajeInicial({
    categoria: 'caso_prueba',
    longitud: 4,
    tema: '  Cómo\n conseguí   mis primeros clientes ',
  })
  assert.match(m, /secuencia de 5 historias/)
  assert.match(m, /Categoría: Caso con prueba y cifras \(caso_prueba\)/)
  assert.match(m, /Tema: Cómo conseguí mis primeros clientes/)
  assert.match(m, /fotos subidas/)
  assert.match(
    mensajeInicial({ categoria: 'auto', longitud: 3, tema: '' }),
    /propón el que mejor encaje con mi negocio/
  )
  assert.match(mensajeInicial({ categoria: 'auto', longitud: 3, tema: '' }), /Elige tú la categoría/)
})

test('el tema se recorta y una categoría inventada lanza', () => {
  const m = mensajeInicial({ categoria: 'auto', longitud: 5, tema: 'x'.repeat(5000) })
  assert.ok(m.length < MAX_TEMA + 400)
  assert.throws(() => mensajeInicial({ categoria: 'inventada', longitud: 5, tema: '' }), /desconocida/)
})

test('las opciones del diálogo cubren «auto» y todas las categorías, con longitudes 3/5/7', () => {
  assert.deepEqual(
    OPCIONES_CATEGORIA.map((o) => o.id),
    ['auto', ...Object.keys(CATEGORIAS)]
  )
  assert.deepEqual([...LONGITUDES], [3, 5, 7])
  assert.equal(claveEncargo('abc'), 'carrusel-encargo-abc')
})

test('en historias el prompt lista las fotos subidas CON su URL y explica cómo usarlas; en carruseles no', () => {
  const fotos = [{ id: '1', url: 'https://cdn.example.test/a.jpg', name: 'espejo.jpg', addedAt: '' }]
  const h = buildSystemPrompt(marca, proyecto('9:16', fotos))
  assert.match(h, /Fotos subidas para esta secuencia/)
  assert.match(h, /"espejo\.jpg": https:\/\/cdn\.example\.test\/a\.jpg/)
  assert.match(h, /<img class="ig-foto" src="URL">/)
  assert.match(h, /nunca una foto inventada/)
  const c = buildSystemPrompt(marca, proyecto('4:5', fotos))
  assert.doesNotMatch(c, /cdn\.example\.test/, 'un carrusel no expone las URL en esta sección')
  assert.match(c, /Imágenes de referencia/)
})

test('el contexto de negocio y los assets son de la subcuenta (cfg), no de variables globales del proceso', () => {
  const ruta = readFileSync('app/api/[tenant]/evergreen/carruseles/chat/route.ts', 'utf8')
  assert.match(ruta, /cfg\.IG_BUSINESS_CONTEXT/)
  assert.match(ruta, /parseBrandAssets\(cfg\.IG_BRAND_ASSETS\)/)
  assert.doesNotMatch(ruta, /process\.env\.IG_/)
})

test('el diálogo y el chat usan el mismo encargo y el chat no lo envía solo', () => {
  const dlg = readFileSync('components/carruseles/CreateProjectDialog.tsx', 'utf8')
  assert.match(dlg, /esHistorias = kind === 'carousel' && ratio === '9:16'/)
  assert.match(dlg, /sessionStorage\.setItem\(claveEncargo\(project\.id\)/)
  const chat = readFileSync('components/carruseles/ChatPanel.tsx', 'utf8')
  assert.match(chat, /Generar secuencia/)
  assert.match(chat, /sessionStorage\.removeItem\(claveEncargo\(projectId\)\)/)
  assert.doesNotMatch(chat, /useEffect\(\(\) => \{[^}]*handleSend\(encargo/)
})
