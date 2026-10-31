import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { aEsquemaGemini, aspectoGemini, geminiGenerar, geminiImagen } from '../lib/ai/gemini.ts'
import { openaiChat, openaiImagen, tamanoOpenAi } from '../lib/ai/openai.ts'
import {
  ejecutarBucleGenerico,
  elegirMotorImagen,
  elegirMotorTexto,
  modeloImagen,
  modeloTexto,
} from '../lib/carruseles/motor.ts'
import { generarImagenIA, reforzarPrompt } from '../lib/carruseles/imagenes.ts'

const respuesta = (cuerpo, ok = true, status = 200) => ({ ok, status, text: async () => JSON.stringify(cuerpo) })

// ── Elección de motor
test('motor de texto: cualquiera de las tres claves basta; Anthropic primero salvo que se pida otro', () => {
  assert.equal(elegirMotorTexto({}), null)
  assert.equal(elegirMotorTexto({ ANTHROPIC_API_KEY: 'a' }), 'anthropic')
  assert.equal(
    elegirMotorTexto({ GEMINI_API_KEY: 'g' }),
    'gemini',
    'sin Anthropic, Gemini: ya no se bloquea el carrusel'
  )
  assert.equal(elegirMotorTexto({ OPENAI_API_KEY: 'o' }), 'openai')
  assert.equal(elegirMotorTexto({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g' }), 'anthropic')
  assert.equal(
    elegirMotorTexto({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', CARRUSELES_IA_MOTOR: 'gemini' }),
    'gemini'
  )
  assert.equal(
    elegirMotorTexto({ GEMINI_API_KEY: 'g', CARRUSELES_IA_MOTOR: 'openai' }),
    'gemini',
    'un motor pedido sin clave se ignora'
  )
  assert.equal(elegirMotorTexto({ ANTHROPIC_API_KEY: '   ' }), null, 'una clave en blanco no cuenta')
})

test('motor de imágenes: Gemini primero, luego OpenAI; Anthropic sola no genera imágenes', () => {
  assert.equal(elegirMotorImagen({ ANTHROPIC_API_KEY: 'a' }), null)
  assert.equal(elegirMotorImagen({ GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o' }), 'gemini')
  assert.equal(elegirMotorImagen({ OPENAI_API_KEY: 'o' }), 'openai')
  assert.equal(
    elegirMotorImagen({ GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o', CARRUSELES_IMAGEN_MOTOR: 'openai' }),
    'openai'
  )
  assert.equal(modeloImagen({}, 'gemini'), 'gemini-2.5-flash-image')
  assert.equal(modeloImagen({ GEMINI_MODELO_IMAGEN: 'gemini-3-pro-image' }, 'gemini'), 'gemini-3-pro-image')
  assert.equal(modeloTexto({}, 'openai'), 'gpt-4.1')
})

// ── Gemini
test('gemini: esquema en mayúsculas, clave en cabecera (no en la URL), herramientas y parseo de llamadas', async () => {
  assert.deepEqual(
    aEsquemaGemini({ type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } }),
    {
      type: 'OBJECT',
      properties: { a: { type: 'STRING' } },
    }
  )
  let visto
  const f = async (url, init) => {
    visto = { url, init, cuerpo: JSON.parse(init.body) }
    return respuesta({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: 'hecho' }, { functionCall: { id: 'c1', name: 'add_slide', args: { html: '<p/>' } } }],
          },
        },
      ],
    })
  }
  const r = await geminiGenerar({
    apiKey: 'SECRETA',
    system: 'sys',
    contents: [{ role: 'user', parts: [{ text: 'hola' }] }],
    tools: [
      {
        name: 'add_slide',
        description: 'd',
        parameters: { type: 'object', properties: { html: { type: 'string' } }, required: ['html'] },
      },
    ],
    fetchImpl: f,
  })
  assert.ok(!visto.url.includes('SECRETA'), 'la clave no va en la URL')
  assert.equal(visto.init.headers['x-goog-api-key'], 'SECRETA')
  assert.equal(visto.cuerpo.tools[0].functionDeclarations[0].parameters.type, 'OBJECT')
  assert.equal(visto.cuerpo.systemInstruction.parts[0].text, 'sys')
  assert.deepEqual(r.llamadas, [{ id: 'c1', name: 'add_slide', args: { html: '<p/>' } }])
  assert.equal(r.texto, 'hecho')
  assert.equal(r.contenido.role, 'model', 'el contenido del modelo se conserva para devolverlo en el turno siguiente')
})

test('gemini imagen: pide aspecto válido, devuelve los bytes y explica cuando no hay imagen', async () => {
  assert.equal(aspectoGemini('4:5'), '4:5')
  assert.equal(aspectoGemini('A4'), '3:4')
  assert.equal(aspectoGemini('raro'), '1:1')
  let cuerpo
  const f = async (_u, init) => {
    cuerpo = JSON.parse(init.body)
    return respuesta({
      candidates: [
        {
          content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('PNG!').toString('base64') } }] },
        },
      ],
    })
  }
  const img = await geminiImagen({ apiKey: 'k', prompt: 'una foto', aspectRatio: '9:16', fetchImpl: f })
  assert.equal(img.datos.toString(), 'PNG!')
  assert.equal(cuerpo.generationConfig.imageConfig.aspectRatio, '9:16')
  await assert.rejects(
    geminiImagen({
      apiKey: 'k',
      prompt: 'x',
      fetchImpl: async () => respuesta({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] }),
    }),
    /SAFETY/
  )
  await assert.rejects(
    geminiImagen({
      apiKey: 'k',
      prompt: 'x',
      fetchImpl: async () => respuesta({ error: { message: 'cuota' } }, false, 429),
    }),
    /429.*cuota/
  )
})

// ── OpenAI
test('openai: herramientas en formato function, argumentos JSON y tamaño de imagen según la forma', async () => {
  let cuerpo
  const f = async (_u, init) => {
    cuerpo = JSON.parse(init.body)
    return respuesta({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              { id: 't1', function: { name: 'add_slide', arguments: '{"html":"<p/>"}' } },
              { id: 't2', function: { name: 'x', arguments: '{roto' } },
            ],
          },
        },
      ],
    })
  }
  const r = await openaiChat({
    apiKey: 'k',
    messages: [{ role: 'user', content: 'hola' }],
    tools: [{ name: 'add_slide', description: 'd', parameters: { type: 'object', properties: {} } }],
    fetchImpl: f,
  })
  assert.equal(cuerpo.tools[0].type, 'function')
  assert.deepEqual(r.llamadas[0], { id: 't1', name: 'add_slide', args: { html: '<p/>' } })
  assert.deepEqual(r.llamadas[1].args, {}, 'argumentos mal formados → objeto vacío (la herramienta devolverá su error)')
  assert.equal(tamanoOpenAi('9:16'), '1024x1536')
  assert.equal(tamanoOpenAi('1:1'), '1024x1024')
  assert.equal(tamanoOpenAi('16:9'), '1536x1024')
  const img = await openaiImagen({
    apiKey: 'k',
    prompt: 'p',
    aspectRatio: '4:5',
    fetchImpl: async () => respuesta({ data: [{ b64_json: Buffer.from('X').toString('base64') }] }),
  })
  assert.equal(img.datos.toString(), 'X')
})

// ── Bucle genérico
test('bucle genérico (Gemini): ejecuta las herramientas, devuelve UNA respuesta por llamada y acaba cuando no hay más', async () => {
  const ejecutadas = []
  const turnos = [
    {
      contenido: { role: 'model', parts: [] },
      texto: '',
      llamadas: [
        { id: 'a', name: 'add_slide', args: { html: '1' } },
        { id: 'b', name: 'add_slide', args: { html: '2' } },
      ],
    },
    { contenido: { role: 'model', parts: [] }, texto: 'Listo', llamadas: [] },
  ]
  let n = 0
  const vistos = []
  const r = await ejecutarBucleGenerico({
    motor: 'gemini',
    cfg: { GEMINI_API_KEY: 'k' },
    system: 's',
    historial: [],
    textoUsuario: 'crea 2',
    imagenes: [],
    tools: [],
    ejecutar: async (nombre, args) => (ejecutadas.push([nombre, args.html]), 'OK'),
    onTexto: (t) => vistos.push(t),
    onCambio: () => {},
    gemini: async (p) => {
      const ultimo = p.contents[p.contents.length - 1]
      if (n === 1) assert.equal(ultimo.parts.length, 2, 'una functionResponse por cada llamada')
      return turnos[n++]
    },
  })
  assert.deepEqual(ejecutadas, [
    ['add_slide', '1'],
    ['add_slide', '2'],
  ])
  assert.deepEqual(vistos, ['Listo'])
  assert.equal(r.truncado, false)
})

test('bucle genérico (OpenAI): resultados como mensajes role tool y empujón cuando faltan slides', async () => {
  let n = 0
  const cont = ['Faltan slides', null]
  const r = await ejecutarBucleGenerico({
    motor: 'openai',
    cfg: { OPENAI_API_KEY: 'k' },
    system: 's',
    historial: [],
    textoUsuario: 'x',
    imagenes: [],
    tools: [],
    ejecutar: async () => 'OK',
    continuar: async () => cont.shift() ?? null,
    onTexto: () => {},
    onCambio: () => {},
    openai: async (p) => {
      n++
      if (n === 1) return { mensaje: { role: 'assistant', content: 'a' }, texto: 'a', llamadas: [] }
      if (n === 2) {
        assert.equal(p.messages[p.messages.length - 1].content, 'Faltan slides', 'se le empuja a continuar')
        return {
          mensaje: { role: 'assistant', tool_calls: [] },
          texto: '',
          llamadas: [{ id: 'z', name: 'add_slide', args: {} }],
        }
      }
      assert.equal(p.messages[p.messages.length - 1].role, 'tool')
      assert.equal(p.messages[p.messages.length - 1].tool_call_id, 'z')
      return { mensaje: { role: 'assistant', content: 'fin' }, texto: 'fin', llamadas: [] }
    },
  })
  assert.equal(r.truncado, false)
  assert.equal(n, 3)
})

test('bucle genérico: se acota por tiempo y por iteraciones (la función de Vercel tiene tope)', async () => {
  let t = 0
  const r = await ejecutarBucleGenerico({
    motor: 'gemini',
    cfg: { GEMINI_API_KEY: 'k' },
    system: 's',
    historial: [],
    textoUsuario: 'x',
    imagenes: [],
    tools: [],
    ejecutar: async () => 'OK',
    onTexto: () => {},
    onCambio: () => {},
    presupuestoMs: 1000,
    ahora: () => (t += 600),
    gemini: async () => ({
      contenido: { role: 'model', parts: [] },
      texto: '',
      llamadas: [{ name: 'add_slide', args: {} }],
    }),
  })
  assert.equal(r.truncado, true)
})

// ── Imágenes
test('el prompt de imagen pide NO pintar texto y reservar zona para el titular', () => {
  const p = reforzarPrompt('woman at a laptop', { formato: '9:16', marca: 'Demo', estilo: ['limpio'] })
  assert.match(p, /NO incluyas texto/)
  assert.match(p, /zona despejada/)
  assert.match(p, /historia vertical/)
  assert.ok(reforzarPrompt('x'.repeat(5000), { formato: '1:1' }).length < 2200)
})

test('generarImagenIA: elige proveedor, sube a Storage y devuelve la URL pública', async () => {
  const subidas = []
  const r = await generarImagenIA({
    cfg: { GEMINI_API_KEY: 'g' },
    tenantSlug: 'demo',
    prompt: 'portada de lanzamiento con luz cálida',
    formato: '4:5',
    gemini: async (p) => (assert.equal(p.aspectRatio, '4:5'), { mime: 'image/png', datos: Buffer.from('IMG') }),
    subir: async (ruta, datos, mime) => (subidas.push({ ruta, mime }), `https://cdn.example.test/${ruta}`),
  })
  assert.equal(r.motor, 'gemini')
  assert.match(r.url, /^https:\/\/cdn\.example\.test\/demo\/ia\/[0-9a-f-]+\.png$/)
  await assert.rejects(generarImagenIA({ cfg: {}, tenantSlug: 'd', prompt: 'x', formato: '1:1' }), /No hay clave/)
})

test('la ruta del chat ya no exige Anthropic y ofrece generate_image solo con clave de imágenes', () => {
  const ruta = readFileSync('app/api/[tenant]/evergreen/carruseles/chat/route.ts', 'utf8')
  assert.doesNotMatch(ruta, /ANTHROPIC_API_KEY no configurada/)
  assert.match(ruta, /elegirMotorTexto\(cfg\)/)
  assert.match(ruta, /imagenesIA \? \[\.\.\.TOOLS, TOOL_IMAGEN\] : TOOLS/)
  assert.match(ruta, /MAX_IMAGENES_POR_PETICION/)
})
