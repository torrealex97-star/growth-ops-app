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
  assert.match(h, /Fotos y vídeos subidos para esta secuencia/)
  assert.match(h, /1\. "espejo\.jpg" \(foto\)/)
  assert.match(h, /campo foto \(su número\)/)
  assert.doesNotMatch(h, /cdn\.example\.test/, 'las historias se componen en el servidor: la IA no maneja URLs')
  assert.match(h, /Usa SOLO las fotos y vídeos subidos/)
  const c = buildSystemPrompt(marca, proyecto('4:5', fotos))
  assert.doesNotMatch(c, /cdn\.example\.test/, 'un carrusel no expone las URL en esta sección')
  assert.match(c, /Imágenes de referencia/)
})

test('el contexto de negocio y los assets salen de la config PROPIA de la subcuenta, sin relevo a process.env', () => {
  const ruta = readFileSync('app/api/[tenant]/evergreen/carruseles/chat/route.ts', 'utf8')
  assert.match(ruta, /const propia = await getTenantConfig\(t\.tenantId, true\)/)
  assert.match(ruta, /propia\.IG_BUSINESS_CONTEXT/)
  assert.match(ruta, /parseBrandAssets\(propia\.IG_BRAND_ASSETS\)/)
  assert.doesNotMatch(ruta, /process\.env\.IG_|cfg\.IG_BUSINESS_CONTEXT|cfg\.IG_BRAND_ASSETS/)
})

test('sin fotos subidas el prompt de historias manda fondo liso y prohíbe inventar URLs', () => {
  const p = buildSystemPrompt(marca, proyecto('9:16', []))
  assert.match(p, /No hay fotos ni vídeos subidos: las historias llevarán fondo liso/)
  assert.match(p, /NUNCA inventes URLs de fotos/)
  const con = buildSystemPrompt(
    marca,
    proyecto('9:16', [{ id: '1', url: 'https://cdn.example.test/a.jpg', name: 'a.jpg', addedAt: '' }])
  )
  assert.match(con, /Usa SOLO las fotos y vídeos subidos/)
  assert.doesNotMatch(con, /No hay fotos ni vídeos subidos/)
})

test('la fecha, el logo y la marca los pone la app, no la IA (y la fecha sale de hoy)', () => {
  const p = buildSystemPrompt(marca, proyecto('9:16'), null, [], false, new Date(2026, 10, 2))
  assert.match(p, /La fecha, el logo, las tipografías y los colores de la marca los pone la app/)
  assert.doesNotMatch(p, /<span>8<\/span><span>ene\.<\/span>/, 'sin fecha de ejemplo fija')
})

test('el diálogo y el chat usan el mismo encargo y el chat no lo envía solo', () => {
  const dlg = readFileSync('components/carruseles/CreateProjectDialog.tsx', 'utf8')
  assert.match(dlg, /esHistorias = tipo === 'historias'/)
  assert.match(dlg, /sessionStorage\.setItem\(claveEncargo\(project\.id\)/)
  const chat = readFileSync('components/carruseles/ChatPanel.tsx', 'utf8')
  assert.match(chat, /Generar secuencia/)
  assert.match(chat, /sessionStorage\.removeItem\(claveEncargo\(projectId\)\)/)
  assert.doesNotMatch(chat, /useEffect\(\(\) => \{[^}]*handleSend\(encargo/)
})

test('si el envío del encargo falla, el chat lo vuelve a ofrecer en vez de perderlo', () => {
  const chat = readFileSync('components/carruseles/ChatPanel.tsx', 'utf8')
  assert.match(chat, /async \(message: string\): Promise<boolean>/)
  assert.match(chat, /if \(!\(await handleSend\(texto\)\)\) \{\s*setEncargo\(texto\)/)
  assert.match(chat, /sessionStorage\.setItem\(claveEncargo\(projectId\), texto\)/)
})
