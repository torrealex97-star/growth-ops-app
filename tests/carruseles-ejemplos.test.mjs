import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  MAX_EJEMPLOS_POR_TIPO,
  MAX_GUIA,
  analizarEjemplos,
  conEjemplo,
  conGuia,
  descargarEjemplo,
  leerEjemplosDeSettings,
  seccionGuiaPrompt,
  sinEjemplo,
} from '../lib/carruseles/ejemplos.ts'
import { buildSystemPrompt } from '../lib/carruseles/system-prompt.ts'
import { DEFAULT_BRAND } from '../lib/carruseles/types.ts'

const ej = (id, tipo = 'historias') => ({
  id,
  url: `https://cdn.example.test/${id}.jpg`,
  name: `${id}.jpg`,
  tipo,
  addedAt: '',
})
const vacio = { ejemplos: [], guia: { historias: '', carrusel: '' } }
const img = { mime: 'image/jpeg', base64: 'AAAA' }

test('lectura de settings: tolera datos ausentes o mal formados', () => {
  assert.deepEqual(leerEjemplosDeSettings(null), vacio)
  assert.deepEqual(leerEjemplosDeSettings({ carruseles_ejemplos: { ejemplos: 'x', guia: 5 } }), vacio)
  const r = leerEjemplosDeSettings({
    carruseles_ejemplos: { ejemplos: [ej('a'), { id: 1 }, { ...ej('b'), tipo: 'otro' }], guia: { historias: 'G' } },
  })
  assert.equal(r.ejemplos.length, 1)
  assert.equal(r.guia.historias, 'G')
})

test('añadir, quitar y límite por tipo; la guía se recorta', () => {
  let e = vacio
  for (let i = 0; i < MAX_EJEMPLOS_POR_TIPO; i++) e = conEjemplo(e, ej(`h${i}`))
  assert.throws(() => conEjemplo(e, ej('extra')), /Máximo/)
  assert.ok(conEjemplo(e, ej('c1', 'carrusel')), 'el límite es por tipo')
  assert.equal(sinEjemplo(e, 'h0').ejemplos.length, MAX_EJEMPLOS_POR_TIPO - 1)
  assert.equal(conGuia(vacio, 'carrusel', `  ${'x'.repeat(MAX_GUIA + 50)} `).guia.carrusel.length, MAX_GUIA)
})

test('el análisis usa el motor con clave y pide una guía del tipo y nº de capturas correctos', async () => {
  let visto = null
  const anthropic = async (p) => ((visto = p), '  - Fuente: Inter  ')
  assert.equal(
    await analizarEjemplos({ ANTHROPIC_API_KEY: 'a' }, 'historias', [img, img], { anthropic }),
    '- Fuente: Inter'
  )
  assert.match(visto.texto, /2 capturas de HISTORIAS/)
  assert.equal(visto.imagenes.length, 2)

  let gemini = null
  const g = async (p) => ((gemini = p), { texto: 'guía gemini' })
  assert.equal(await analizarEjemplos({ GEMINI_API_KEY: 'g' }, 'carrusel', [img], { gemini: g }), 'guía gemini')
  assert.match(gemini.contents[0].parts[0].text, /CARRUSELES/)
  assert.deepEqual(gemini.contents[0].parts[1], { inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } })

  let openai = null
  const o = async (p) => ((openai = p), { texto: 'guía openai' })
  assert.equal(
    await analizarEjemplos(
      { OPENAI_API_KEY: 'o', OPENAI_BASE_URL: 'https://api.groq.com/openai/v1' },
      'historias',
      [img],
      { openai: o }
    ),
    'guía openai'
  )
  assert.equal(openai.baseUrl, 'https://api.groq.com/openai/v1')
  assert.match(openai.messages[0].content[1].image_url.url, /^data:image\/jpeg;base64,AAAA/)
})

test('el análisis falla con claridad: sin clave, sin ejemplos o con respuesta vacía', async () => {
  await assert.rejects(analizarEjemplos({}, 'historias', [img]), /clave de IA/)
  await assert.rejects(analizarEjemplos({ GEMINI_API_KEY: 'g' }, 'historias', []), /No hay ejemplos/)
  await assert.rejects(
    analizarEjemplos({ GEMINI_API_KEY: 'g' }, 'historias', [img], { gemini: async () => ({ texto: ' ' }) }),
    /no devolvió/
  )
})

test('descargar un ejemplo: solo https público, imagen y tamaño razonable', async () => {
  assert.equal(await descargarEjemplo('http://cdn.example.test/a.jpg'), null, 'http no')
  assert.equal(await descargarEjemplo('https://localhost/a.jpg'), null, 'red interna no')
  const resp = (tipo, n) => ({ ok: true, headers: { get: () => tipo }, arrayBuffer: async () => new ArrayBuffer(n) })
  assert.equal(await descargarEjemplo('https://cdn.example.test/a.pdf', async () => resp('application/pdf', 10)), null)
  assert.equal(
    await descargarEjemplo('https://cdn.example.test/a.jpg', async () => resp('image/jpeg', 5 * 1024 * 1024)),
    null
  )
  assert.equal(
    (await descargarEjemplo('https://cdn.example.test/a.jpg', async () => resp('image/jpeg', 3))).mime,
    'image/jpeg'
  )
})

test('la guía del tenant entra en el prompt de SU producto y nunca en un flyer', () => {
  const proyecto = (ratio, kind = 'carousel') => ({
    id: 'p',
    title: 'T',
    kind,
    aspectRatio: ratio,
    slides: [],
    referenceImages: [],
    caption: null,
    hashtags: [],
    isTemplate: false,
    createdAt: '',
    updatedAt: '',
  })
  const guia = { texto: 'Cajas negras y fuente Strong.', adjuntas: 2 }
  const h = buildSystemPrompt(DEFAULT_BRAND, proyecto('9:16'), null, [], false, new Date(), undefined, guia)
  assert.match(h, /Estilo del tenant \(sacado de sus propios ejemplos de historias\)/)
  assert.match(h, /Cajas negras y fuente Strong\./)
  assert.match(h, /Se adjuntan 2 ejemplos reales/)
  assert.match(
    buildSystemPrompt(DEFAULT_BRAND, proyecto('4:5'), null, [], false, new Date(), undefined, guia),
    /ejemplos de carruseles/
  )
  assert.doesNotMatch(
    buildSystemPrompt(DEFAULT_BRAND, proyecto('9:16', 'flyer'), null, [], false, new Date(), undefined, guia),
    /Estilo del tenant/
  )
  assert.equal(seccionGuiaPrompt('historias', '  ', 0), '')
})

test('la ruta de ejemplos solo deja editar a liderazgo, limita los análisis y la generación lee la guía del tenant', () => {
  const ruta = readFileSync('app/api/[tenant]/evergreen/carruseles/ejemplos/route.ts', 'utf8')
  assert.equal(
    (ruta.match(/PUEDEN_EDITAR\.includes\(t\.role/g) ?? []).length,
    4,
    'GET informa y POST/PUT/DELETE exigen rol'
  )
  assert.match(ruta, /limitar\(`analizar-ejemplos:\$\{t\.tenantId\}`/)
  const chat = readFileSync('app/api/[tenant]/evergreen/carruseles/chat/route.ts', 'utf8')
  assert.match(chat, /leerEjemplos\(t\.tenantId\)/)
  assert.match(chat, /project\.kind === 'flyer' \? null/)
})
