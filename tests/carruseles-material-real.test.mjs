import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { leerSpec, renderHistoria } from '../lib/carruseles/historias/layouts.ts'
import { leerSpecDeHtml, limpiarClave, pedidosPendientes } from '../lib/carruseles/historias/pedidos.ts'
import { buildSystemPrompt } from '../lib/carruseles/system-prompt.ts'
import { DEFAULT_BRAND } from '../lib/carruseles/types.ts'

const marca = { ...DEFAULT_BRAND, name: 'Demo', colors: { ...DEFAULT_BRAND.colors, accent: '#e11d74' } }
const ctx = (o = {}) => ({
  brand: marca,
  estilo: 'nativo',
  media: [],
  hoy: new Date(2026, 10, 3),
  indice: 1,
  total: 5,
  ...o,
})
const pedido = { clave: 'pago-marta', tipo: 'captura_pago', titulo: 'Captura del pago de Marta' }
const spec = (o = {}) => {
  const r = leerSpec({ layout: 'captura', titulo: 'Así entró el primer pago', pedido, ...o })
  assert.ok(r.ok, r.error)
  return r.spec
}

test('captura: exige un pedido válido y normaliza la clave', () => {
  assert.equal(leerSpec({ layout: 'captura', titulo: 'x' }).ok, false)
  assert.equal(leerSpec({ layout: 'captura', pedido: { clave: 'a', tipo: 'inventado' } }).ok, false)
  assert.equal(limpiarClave('  Pago de Marta!! '), 'pago-de-marta')
  assert.equal(spec({ pedido: { ...pedido, clave: 'Pago Marta' } }).pedido.clave, 'pago-marta')
})

test('sin la imagen real, la historia lleva un hueco marcado y no inventa nada', () => {
  const h = renderHistoria(spec(), ctx())
  assert.match(
    h,
    /class="ig-pedido" data-pedido="pago-marta" data-tipo="captura_pago" data-titulo="Captura del pago de Marta"/
  )
  assert.match(h, /FALTA/)
  assert.doesNotMatch(h, /ig-captura-real/)
  assert.deepEqual(
    pedidosPendientes([
      { id: 's1', html: h },
      { id: 's2', html: '<div></div>' },
    ]),
    [{ ...pedido, slideId: 's1' }]
  )
})

test('con la imagen subida, la historia la muestra enmarcada y ya no queda pendiente', () => {
  const h = renderHistoria(spec(), ctx({ pedidos: { 'pago-marta': 'https://cdn.example.test/pago.png' } }))
  assert.match(h, /<div class="ig-captura-real"><img src="https:\/\/cdn\.example\.test\/pago\.png"/)
  assert.doesNotMatch(h, /data-pedido=/)
  assert.deepEqual(pedidosPendientes([{ id: 's1', html: h }]), [])
})

test('el título del pedido se escapa (no se puede colar HTML por el pedido)', () => {
  const h = renderHistoria(spec({ pedido: { ...pedido, titulo: '"><script>x</script>' } }), ctx())
  assert.doesNotMatch(h, /<script>/)
  const [p] = pedidosPendientes([{ id: 's', html: h }])
  assert.equal(p.titulo, '"><script>x</script>', 'se recupera tal cual para mostrarlo como texto')
})

test('la especificación va incrustada: se recompone igual y con la fecha original, sin IA', () => {
  const s = spec()
  const original = renderHistoria(s, ctx({ estilo: 'editorial' }))
  const previa = leerSpecDeHtml(original)
  assert.equal(previa.estilo, 'editorial')
  assert.equal(previa.hoy.getFullYear(), 2026)
  assert.deepEqual(previa.spec.pedido, s.pedido)
  assert.equal(renderHistoria(previa.spec, ctx({ estilo: 'editorial', hoy: previa.hoy })), original)
  assert.equal(leerSpecDeHtml('<div class="ig-historia"></div>'), null, 'una historia antigua no se puede recomponer')
  assert.equal(leerSpecDeHtml('<div data-spec="{no json">'), null)
})

test('el material real no cuenta como foto de fondo en el prompt y se lista aparte con su clave', () => {
  const refs = [
    { id: '1', url: 'https://cdn.example.test/a.jpg', name: 'espejo.jpg', addedAt: '' },
    { id: '2', url: 'https://cdn.example.test/p.png', name: 'pago.png', addedAt: '', pedido: 'pago-marta' },
  ]
  const proyecto = {
    id: 'p',
    title: 'T',
    kind: 'carousel',
    aspectRatio: '9:16',
    slides: [],
    referenceImages: refs,
    caption: null,
    hashtags: [],
    isTemplate: false,
    createdAt: '',
    updatedAt: '',
  }
  const p = buildSystemPrompt(DEFAULT_BRAND, proyecto)
  assert.match(p, /1\. "espejo\.jpg" \(foto\)/)
  assert.doesNotMatch(p, /2\. "pago\.png"/)
  assert.match(p, /Material real ya subido[^\n]*\n- clave «pago-marta»: pago\.png/)
  assert.match(p, /- captura: PRUEBA REAL/)
  assert.match(p, /NUNCA inventes capturas, cifras ni testimonios/)
  const solo = buildSystemPrompt(DEFAULT_BRAND, { ...proyecto, referenceImages: [refs[1]] })
  assert.match(solo, /No hay fotos ni vídeos subidos/, 'solo hay material real: las historias van con fondo liso')
})

test('la subida etiqueta el pedido y recompone; la pantalla pide el material y avisa al exportar', () => {
  const up = readFileSync('app/api/[tenant]/evergreen/carruseles/upload/route.ts', 'utf8')
  assert.match(up, /limpiarClave\(body\.pedido\)/)
  assert.match(up, /recomponerHistorias\(t\.tenantId, body\.projectId\)/)
  const chat = readFileSync('components/carruseles/ChatPanel.tsx', 'utf8')
  assert.match(chat, /<PedidosPanel projectId=\{projectId\} slides=\{slides\}/)
  assert.match(chat, /carruseles\/recomponer/)
  assert.match(readFileSync('components/carruseles/ExportButton.tsx', 'utf8'), /data-pedido=/)
  const rec = readFileSync('lib/carruseles/recomponer.ts', 'utf8')
  assert.doesNotMatch(rec, /anthropic|gemini|openai|completeText/i, 'recomponer no llama a ninguna IA')
})
