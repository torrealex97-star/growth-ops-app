import assert from 'node:assert/strict'
import test from 'node:test'
import { construirPromptVisual, generarImagen, ImageError, proveedoresDisponibles } from '../lib/ai/imagenes.ts'

// EL CONTRATO. Las imágenes de carruseles, flyers e historias se generan con el proveedor que la
// subcuenta tenga (Gemini u OpenAI). Ninguno es obligatorio; si el preferido falla, el otro toma el
// relevo y se deja escrito por qué. Sin red: se inyecta fetch.

const ok = (data) => ({ ok: true, status: 200, json: async () => data })
const ko = (status, message) => ({ ok: false, status, json: async () => ({ error: { message } }) })
const GEMINI_OK = {
  candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'R0VNSU5J' } }] } }],
}
const OPENAI_OK = { data: [{ b64_json: 'T1BFTkFJ' }] }

test('solo Gemini conectada: genera con Nano Banana, con relación de aspecto y clave en cabecera', async () => {
  const llamadas = []
  const r = await generarImagen(
    { prompt: 'portada', formato: '4:5' },
    { GEMINI_API_KEY: 'g-key' },
    async (url, init) => {
      llamadas.push({ url: String(url), init })
      return ok(GEMINI_OK)
    }
  )
  assert.equal(r.proveedor, 'gemini')
  assert.equal(r.base64, 'R0VNSU5J')
  assert.equal(r.fallbackReason, undefined)
  assert.match(llamadas[0].url, /gemini-2\.5-flash-image:generateContent$/)
  assert.equal(llamadas[0].init.headers['x-goog-api-key'], 'g-key')
  assert.ok(!llamadas[0].url.includes('g-key'), 'la clave no va en la URL')
  const cuerpo = JSON.parse(llamadas[0].init.body)
  assert.equal(cuerpo.generationConfig.imageConfig.aspectRatio, '4:5')
  assert.deepEqual(cuerpo.generationConfig.responseModalities, ['IMAGE'])
})

test('solo OpenAI conectada: gpt-image-1 con tamaño según formato', async () => {
  const cuerpos = []
  const r = await generarImagen({ prompt: 'flyer', formato: '1:1' }, { OPENAI_API_KEY: 'o-key' }, async (url, init) => {
    assert.match(String(url), /api\.openai\.com\/v1\/images\/generations/)
    assert.equal(init.headers.Authorization, 'Bearer o-key')
    cuerpos.push(JSON.parse(init.body))
    return ok(OPENAI_OK)
  })
  assert.equal(r.proveedor, 'openai')
  assert.equal(cuerpos[0].model, 'gpt-image-1')
  assert.equal(cuerpos[0].size, '1024x1024')
  const historia = await generarImagen(
    { prompt: 'historia', formato: '9:16' },
    { OPENAI_API_KEY: 'o-key' },
    async (_u, init) => {
      cuerpos.push(JSON.parse(init.body))
      return ok(OPENAI_OK)
    }
  )
  assert.equal(historia.proveedor, 'openai')
  assert.equal(cuerpos[1].size, '1024x1536')
})

test('si el preferido falla, el otro conectado toma el relevo y el motivo queda escrito', async () => {
  const r = await generarImagen(
    { prompt: 'x', formato: '1:1', preferido: 'gemini' },
    { GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o' },
    async (url) => (String(url).includes('googleapis') ? ko(429, 'cuota agotada') : ok(OPENAI_OK))
  )
  assert.equal(r.proveedor, 'openai')
  assert.match(r.fallbackReason, /Gemini: HTTP 429: cuota agotada; atendió OpenAI/)
})

test('el preferido no está conectado: atiende el otro y lo dice', async () => {
  const r = await generarImagen(
    { prompt: 'x', formato: '1:1', preferido: 'openai' },
    { GEMINI_API_KEY: 'g' },
    async () => ok(GEMINI_OK)
  )
  assert.equal(r.proveedor, 'gemini')
  assert.match(r.fallbackReason, /OpenAI no está conectado/)
})

test('sin proveedores no se inventa nada: error que dice qué conectar', async () => {
  await assert.rejects(
    () => generarImagen({ prompt: 'x', formato: '1:1' }, {}, async () => assert.fail('no debe llamar')),
    (e) => e instanceof ImageError && /Gemini u OpenAI/.test(e.message)
  )
  await assert.rejects(() => generarImagen({ prompt: '  ', formato: '1:1' }, { GEMINI_API_KEY: 'g' }), /descripción/)
})

test('todos fallan: el error lleva la causa de cada uno; una respuesta sin imagen no cuenta como éxito', async () => {
  await assert.rejects(
    () =>
      generarImagen({ prompt: 'x', formato: '1:1' }, { GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o' }, async (url) =>
        String(url).includes('googleapis')
          ? ok({ candidates: [{ content: { parts: [{ text: 'no puedo' }] } }] })
          : ko(401, 'clave inválida')
      ),
    (e) =>
      e instanceof ImageError &&
      /Gemini: la respuesta no trae ninguna imagen/.test(e.message) &&
      /OpenAI: HTTP 401: clave inválida/.test(e.message)
  )
})

test('proveedoresDisponibles ignora claves vacías y respeta la preferencia', () => {
  assert.deepEqual(proveedoresDisponibles({ GEMINI_API_KEY: ' ', OPENAI_API_KEY: 'o' }), ['openai'])
  assert.deepEqual(proveedoresDisponibles({ GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o' }, 'openai'), ['openai', 'gemini'])
})

test('el prompt visual pide texto exacto, marca y prohíbe marcas de agua/logos ajenos', () => {
  const p = construirPromptVisual({
    tipo: 'historia',
    idea: 'objeción de precio',
    textoEnImagen: '¿Es caro?',
    marca: { nombre: 'Acme', colores: ['#111', '#fff'] },
  })
  assert.match(p, /Historia vertical/)
  assert.match(p, /«¿Es caro\?»/)
  assert.match(p, /Acme/)
  assert.match(p, /Sin marcas de agua/)
})

import { readFileSync } from 'node:fs'
test('el generador de carruseles ya no exige Anthropic: usa DeepSeek si es lo que hay y las claves de imagen están en el catálogo con su guía', () => {
  const chat = readFileSync(new URL('../app/api/[tenant]/evergreen/carruseles/chat/route.ts', import.meta.url), 'utf8')
  assert.ok(!/ANTHROPIC_API_KEY no configurada/.test(chat), 'el 503 por falta de Anthropic era el defecto')
  assert.match(chat, /DEEPSEEK_ANTHROPIC_BASE_URL/)
  assert.match(chat, /usaDeepseek/)
  const catalogo = readFileSync(new URL('../lib/integrations-catalog.ts', import.meta.url), 'utf8')
  const grupoAi = catalogo.slice(catalogo.indexOf("id: 'ai'"), catalogo.indexOf("id: 'youtube'"))
  assert.match(grupoAi, /key: 'GEMINI_API_KEY'[\s\S]*?secret: true/)
  assert.match(grupoAi, /key: 'OPENAI_API_KEY'[\s\S]*?secret: true/)
})
