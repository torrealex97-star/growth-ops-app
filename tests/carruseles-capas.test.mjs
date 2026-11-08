import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LIENZO,
  MAX_CAPAS,
  ajustar,
  alinear,
  capaNueva,
  capasConTextos,
  capasDeSpec,
  conCapas,
  duplicar,
  invasionZonaSegura,
  leerCapas,
  leerFondoPos,
  nuevoId,
  ordenar,
  renderCapas,
} from '../lib/carruseles/historias/capas.ts'
import { LAYOUTS, leerSpec, renderHistoria } from '../lib/carruseles/historias/layouts.ts'
import { leerSpecDeHtml, pedidosPendientes } from '../lib/carruseles/historias/pedidos.ts'
import { DEFAULT_BRAND } from '../lib/carruseles/types.ts'

const foto = { url: 'https://cdn.example.test/a.jpg', kind: 'image', name: 'a.jpg' }
const video = { url: 'https://cdn.example.test/b.mp4', kind: 'video', name: 'b.mp4' }
const ctx = (o = {}) => ({
  brand: DEFAULT_BRAND,
  estilo: 'nativo',
  media: [foto, video],
  hoy: new Date(2026, 10, 3),
  indice: 1,
  total: 5,
  ...o,
})
const libre = (capas, extra = {}) => {
  const r = leerSpec({ layout: 'foto_texto', texto: 'Hola', capas, ...extra })
  assert.ok(r.ok, r.error)
  return r.spec
}

test('leerCapas: acota números, descarta tipos desconocidos y no permite más de MAX_CAPAS', () => {
  const capas = leerCapas([
    { tipo: 'texto', id: 'a', x: 99999, y: -99999, w: 5, texto: 'hola', tam: 9999, rot: 400 },
    { tipo: 'inventada', id: 'b' },
    null,
    'texto',
  ])
  assert.equal(capas.length, 1)
  const [t] = capas
  assert.equal(t.x, 1620)
  assert.equal(t.y, -960)
  assert.equal(t.w, 40)
  assert.equal(t.tam, 260)
  assert.equal(t.rot, 180)
  assert.equal(leerCapas('no es lista').length, 0)
  const muchas = Array.from({ length: MAX_CAPAS + 15 }, (_, i) => ({ tipo: 'emoji', id: `e${i}`, emoji: '🔥' }))
  assert.equal(leerCapas(muchas).length, MAX_CAPAS)
})

test('leerCapas: identificadores únicos y estables aunque vengan repetidos o vacíos', () => {
  const capas = leerCapas([
    { tipo: 'emoji', id: 'x', emoji: '⭐' },
    { tipo: 'emoji', id: 'x', emoji: '🔥' },
    { tipo: 'emoji', emoji: '💡' },
  ])
  assert.equal(new Set(capas.map((c) => c.id)).size, 3)
})

test('leerCapas: solo direcciones https en las imágenes y sin cadenas peligrosas', () => {
  const [a, b, c] = leerCapas([
    { tipo: 'imagen', url: 'https://cdn.example.test/ok.png', w: 300, h: 300 },
    { tipo: 'imagen', url: 'javascript:alert(1)', w: 300, h: 300 },
    { tipo: 'imagen', url: 'http://inseguro.test/x.png', w: 300, h: 300 },
  ])
  assert.equal(a.url, 'https://cdn.example.test/ok.png')
  assert.equal(b.url, undefined)
  assert.equal(c.url, undefined)
})

test('leerCapas: el material real se conserva con su clave limpia y se rechaza un tipo de pedido inventado', () => {
  const [ok, mal] = leerCapas([
    { tipo: 'imagen', w: 300, h: 300, pedido: { clave: 'Pago Enero!', tipo: 'captura_pago', titulo: 'Pago' } },
    { tipo: 'imagen', w: 300, h: 300, pedido: { clave: 'x', tipo: 'inventado' } },
  ])
  assert.equal(ok.pedido.clave, 'pago-enero')
  assert.equal(mal.pedido, undefined)
})

test('leerFondoPos: sin cambios devuelve undefined y acota zoom y enfoque', () => {
  assert.equal(leerFondoPos({ x: 50, y: 50, zoom: 1 }), undefined)
  assert.equal(leerFondoPos(null), undefined)
  assert.deepEqual(leerFondoPos({ x: 500, y: -5, zoom: 9 }), { x: 100, y: 0, zoom: 3 })
})

test('modo libre: se compone con capas (no con la columna de la plantilla) y respeta el orden de apilado', () => {
  const spec = libre([
    {
      tipo: 'texto',
      id: 'uno',
      x: 70,
      y: 400,
      w: 700,
      texto: 'Primero',
      tam: 70,
      color: 'blanco',
      caja: 'sin',
      alinea: 'izq',
    },
    { tipo: 'emoji', id: 'dos', x: 300, y: 900, w: 160, emoji: '🔥', tam: 140 },
  ])
  const html = renderHistoria(spec, ctx())
  assert.ok(!html.includes('ig-zona'), 'no usa la columna de la plantilla')
  assert.ok(html.indexOf('data-capa="uno"') < html.indexOf('data-capa="dos"'), 'la última va encima')
  assert.match(html, /left:70px;top:400px;width:700px/)
})

test('modo libre: capas ocultas no se pintan y el texto se escapa', () => {
  const spec = libre([
    { tipo: 'texto', id: 'a', x: 0, y: 0, w: 500, texto: '<script>alert(1)</script> & "x"', tam: 60, caja: 'blanca' },
    { tipo: 'texto', id: 'b', x: 0, y: 200, w: 500, texto: 'oculto', oculta: true, tam: 60 },
  ])
  const html = renderHistoria(spec, ctx())
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes('data-capa="b"'), 'la capa oculta no se pinta')
  assert.ok(
    leerSpecDeHtml(html).spec.capas.some((c) => c.id === 'b' && c.oculta),
    'pero se conserva para volver a mostrarla'
  )
})

test('modo libre: se admite una historia solo con foto (sin texto) y una lista de capas vacía', () => {
  const r = leerSpec({ layout: 'foto_texto', capas: [] })
  assert.ok(r.ok, 'sin texto pero en modo libre es válida')
  assert.ok(renderHistoria(r.spec, ctx()).includes('ig-historia'))
  // Sin modo libre sigue exigiendo texto (comportamiento de siempre).
  assert.equal(leerSpec({ layout: 'foto_texto' }).ok, false)
})

test('la especificación con capas viaja incrustada y se recupera igual (recomponer sin IA)', () => {
  const spec = libre([{ tipo: 'emoji', id: 'e', x: 100, y: 200, w: 160, emoji: '💡', tam: 140, rot: 12 }], {
    fondoPos: { x: 30, y: 70, zoom: 1.5 },
    velo: 55,
  })
  const html = renderHistoria(spec, ctx())
  const leida = leerSpecDeHtml(html)
  assert.ok(leida)
  assert.equal(leida.spec.capas.length, 1)
  assert.equal(leida.spec.capas[0].rot, 12)
  assert.deepEqual(leida.spec.fondoPos, { x: 30, y: 70, zoom: 1.5 })
  assert.equal(leida.spec.velo, 55)
})

test('encuadre y oscurecimiento de la foto de fondo se aplican; sin ellos sale como siempre', () => {
  const base = renderHistoria(leerSpec({ layout: 'foto_texto', texto: 'x' }).spec, ctx())
  assert.ok(!base.includes('object-position'))
  assert.match(base, /ig-velo ig-velo-\d+/)
  const spec = leerSpec({ layout: 'foto_texto', texto: 'x', fondoPos: { x: 20, y: 80, zoom: 2 }, velo: 33 }).spec
  const html = renderHistoria(spec, ctx())
  assert.match(html, /object-position:20% 80%;transform:scale\(2\);transform-origin:20% 80%/)
  assert.match(html, /<div class="ig-velo" style="opacity:0\.33">/)
})

test('una imagen de capa resuelve su foto de la biblioteca (imagen o vídeo) y, si falta, muestra un hueco', () => {
  const capas = leerCapas([
    { tipo: 'imagen', id: 'f', x: 0, y: 0, w: 400, h: 500, foto: 1 },
    { tipo: 'imagen', id: 'v', x: 0, y: 600, w: 400, h: 500, foto: 2 },
    { tipo: 'imagen', id: 'n', x: 0, y: 1200, w: 400, h: 500, foto: 9 },
  ])
  const html = renderCapas(capas, ctx())
  assert.ok(html.includes('<img src="https://cdn.example.test/a.jpg"'))
  assert.ok(html.includes('<video src="https://cdn.example.test/b.mp4"'))
  assert.ok(html.includes('ig-capa-vacia'))
})

test('el material real en una capa se detecta como pendiente hasta que se sube la imagen', () => {
  const spec = libre([
    {
      tipo: 'imagen',
      id: 'p',
      x: 100,
      y: 300,
      w: 700,
      h: 700,
      pedido: { clave: 'pago', tipo: 'captura_pago', titulo: 'Captura de un pago' },
    },
  ])
  const sin = renderHistoria(spec, ctx())
  assert.equal(pedidosPendientes([{ id: 's1', html: sin }]).length, 1)
  const con = renderHistoria(spec, ctx({ pedidos: { pago: 'https://cdn.example.test/pago.png' } }))
  assert.equal(pedidosPendientes([{ id: 's1', html: con }]).length, 0)
  assert.ok(con.includes('https://cdn.example.test/pago.png'))
})

test('capasDeSpec: cada plantilla produce capas válidas, dentro del lienzo y por debajo de la cabecera', () => {
  const specs = {
    portada: { titulo: 'Un titular largo para la portada de la historia', acento: 'portada' },
    texto: { titulo: 'Título', texto: 'Un texto de apoyo que ocupa un par de líneas dentro de la historia.' },
    foto_texto: { titulo: 'Título', texto: 'Texto' },
    comparacion: {
      titulo: 'Antes y ahora',
      items: [
        { icono: '❌', titulo: 'Antes', texto: 'Mal' },
        { icono: '✅', titulo: 'Ahora' },
      ],
    },
    sticker: { titulo: 'Pregunta', sticker: { tipo: 'pregunta', cabecera: 'HABLEMOS', texto: '¿Qué?' } },
    cifra: { titulo: 'Resultado', cifra: '30mil€' },
    partida: { titulo: 'Dos fotos', texto: 'x' },
    captura: { titulo: 'Prueba', pedido: { clave: 'pago', tipo: 'captura_pago', titulo: 'Pago' } },
  }
  for (const layout of LAYOUTS) {
    const r = leerSpec({ layout, ...specs[layout] })
    assert.ok(r.ok, `${layout}: ${r.error}`)
    const capas = capasDeSpec(r.spec, { hayFoto: true })
    assert.ok(capas.length > 0, layout)
    assert.equal(leerCapas(capas).length, capas.length, `${layout}: todas pasan la validación`)
    for (const c of capas) {
      assert.ok(c.x >= 0 && c.x + c.w <= LIENZO.ancho + 1, `${layout}: ${c.id} cabe a lo ancho`)
      assert.ok(c.y >= 250, `${layout}: ${c.id} queda debajo de la cabecera`)
    }
    // Y la historia convertida se compone sin error.
    assert.ok(renderHistoria({ ...r.spec, capas }, ctx()).includes('data-capa'))
  }
})

test('capasDeSpec: el titular y el texto quedan vinculados a la especificación (rol) y respetan la posición elegida', () => {
  const spec = leerSpec({ layout: 'texto', titulo: 'T', texto: 'x', posicion: 80 }).spec
  const capas = capasDeSpec(spec)
  assert.equal(capas.find((c) => c.rol === 'titulo').texto, 'T')
  assert.equal(capas.find((c) => c.rol === 'texto').texto, 'x')
  const arriba = capasDeSpec(leerSpec({ layout: 'texto', titulo: 'T', texto: 'x', posicion: 6 }).spec)
  assert.ok(capas[0].y > arriba[0].y, 'más abajo cuanto mayor es la posición')
})

test('capaNueva: valores por defecto válidos para cada tipo y centrada o en el punto del arrastre', () => {
  for (const tipo of ['texto', 'imagen', 'emoji', 'sticker', 'forma']) {
    const c = capaNueva(tipo, [])
    assert.equal(leerCapas([c]).length, 1, tipo)
    assert.equal(c.x + c.w / 2, LIENZO.ancho / 2, `${tipo} centrada`)
  }
  const aqui = capaNueva('emoji', [], { x: 200, y: 300, emoji: '🚀' })
  assert.equal(aqui.x + aqui.w / 2, 200)
  assert.equal(aqui.emoji, '🚀')
  assert.equal(capaNueva('imagen', [], { foto: 3 }).foto, 3)
})

test('ordenar y duplicar: el orden de la lista es el de apilado y duplicar no repite identificadores', () => {
  const base = [
    capaNueva('emoji', []),
    capaNueva('texto', [{ id: 'c1' }]),
    capaNueva('forma', [{ id: 'c1' }, { id: 'c2' }]),
  ]
  const ids = base.map((c) => c.id)
  assert.deepEqual(
    ordenar(base, ids[0], 'frente').map((c) => c.id),
    [ids[1], ids[2], ids[0]]
  )
  assert.deepEqual(
    ordenar(base, ids[2], 'fondo').map((c) => c.id),
    [ids[2], ids[0], ids[1]]
  )
  assert.deepEqual(
    ordenar(base, ids[0], 'subir').map((c) => c.id),
    [ids[1], ids[0], ids[2]]
  )
  assert.deepEqual(
    ordenar(base, ids[0], 'bajar').map((c) => c.id),
    ids,
    'ya está al fondo'
  )
  const { capas, nueva } = duplicar(base, ids[1])
  assert.equal(capas.length, 4)
  assert.equal(new Set(capas.map((c) => c.id)).size, 4)
  assert.equal(nueva.x, base[1].x + 40)
  assert.notEqual(nuevoId(capas), nueva.id)
})

test('duplicar no pasa del máximo de capas', () => {
  const llenas = leerCapas(Array.from({ length: MAX_CAPAS }, (_, i) => ({ tipo: 'emoji', id: `e${i}`, emoji: '⭐' })))
  assert.equal(duplicar(llenas, 'e1').nueva, null)
})

test('ajustar: se pega al centro del lienzo y a otras capas dentro del umbral, y no toca lo lejano', () => {
  const centrada = ajustar({ x: 453, y: 100, w: 170, h: 100 }, [])
  assert.equal(centrada.x, 455, 'su centro (538) se pega al del lienzo (540)')
  assert.deepEqual(centrada.guias.x, [540])
  const lejos = ajustar({ x: 300, y: 700, w: 100, h: 100 }, [])
  assert.deepEqual(lejos.guias, { x: [], y: [] })
  assert.equal(lejos.x, 300)
  const conOtra = ajustar({ x: 304, y: 705, w: 100, h: 100 }, [{ x: 300, y: 600, w: 200, h: 100 }])
  assert.equal(conOtra.x, 300, 'borde izquierdo con el de la otra capa')
  assert.equal(conOtra.y, 700, 'su borde superior con el borde inferior de la otra')
})

test('alinear y zona segura: respeta los márgenes de la red y avisa cuando algo queda tapado', () => {
  const caja = { x: 0, y: 500, w: 400, h: 200 }
  assert.equal(alinear(caja, 'centro').x, 340)
  assert.equal(alinear(caja, 'izquierda').x, 70)
  assert.equal(alinear(caja, 'derecha').x, 1080 - 70 - 400)
  assert.equal(alinear(caja, 'arriba').y, 250)
  assert.equal(alinear(caja, 'abajo').y, 1920 - 340 - 200)
  assert.equal(alinear(caja, 'abajo', 'tiktok').y, 1920 - 480 - 200)
  assert.equal(invasionZonaSegura({ x: 100, y: 500, w: 400, h: 200 }), false)
  assert.equal(invasionZonaSegura({ x: 100, y: 100, w: 400, h: 200 }), true, 'tapado por la cabecera de la red')
  assert.equal(invasionZonaSegura({ x: 100, y: 1700, w: 400, h: 200 }), true, 'tapado por la barra de respuesta')
})

test('intercambiar fondos: cada historia se queda con la foto de la otra, con su encuadre, también si una va lisa', async () => {
  const { fondoDe, intercambiarFondos } = await import('../lib/carruseles/historias/fotos.ts')
  const a = {
    spec: leerSpec({ layout: 'foto_texto', texto: 'a', foto: 1, fondoPos: { x: 20, y: 30, zoom: 2 } }).spec,
    ctx: ctx({ indice: 0 }),
  }
  const b = { spec: leerSpec({ layout: 'foto_texto', texto: 'b', foto: 2 }).spec, ctx: ctx({ indice: 1 }) }
  assert.equal(fondoDe(a.spec, a.ctx).foto, 1)
  const [a2, b2] = intercambiarFondos(a, b)
  assert.equal(a2.foto, 2)
  assert.equal(a2.fondoPos, undefined)
  assert.equal(b2.foto, 1)
  assert.deepEqual(b2.fondoPos, { x: 20, y: 30, zoom: 2 })
  const lisa = { spec: leerSpec({ layout: 'texto', texto: 'c', fondo: 'liso' }).spec, ctx: ctx({ indice: 2 }) }
  const [a3, l3] = intercambiarFondos(a, lisa)
  assert.equal(a3.fondo, 'liso')
  assert.equal(l3.foto, 1)
  // Sin fotos en la biblioteca no hay nada que intercambiar.
  assert.equal(intercambiarFondos({ spec: a.spec, ctx: ctx({ media: [] }) }, b), null)
})

test('la elección automática de foto también cuenta: sin `foto` explícita se intercambia la que le tocaba', async () => {
  const { fondoDe } = await import('../lib/carruseles/historias/fotos.ts')
  const s = leerSpec({ layout: 'foto_texto', texto: 'x' }).spec
  assert.equal(fondoDe(s, ctx({ indice: 0 })).foto, 1)
  assert.equal(fondoDe(s, ctx({ indice: 1 })).foto, 2)
})

test('conCapas: el titular y el texto de la especificación siguen a sus capas (edición, borrado) y el resto no se toca', () => {
  const base = leerSpec({ layout: 'texto', titulo: 'Gancho', acento: 'Gancho', texto: 'Apoyo' }).spec
  const capas = capasDeSpec(base)
  const sinCambios = conCapas({ ...base, capas }, capas)
  assert.equal(sinCambios.titulo, 'Gancho')
  const editadas = capas.map((c) => (c.rol === 'titulo' ? { ...c, texto: 'Otro gancho', acento: 'Otro' } : c))
  const conEdicion = conCapas({ ...base, capas }, editadas)
  assert.equal(conEdicion.titulo, 'Otro gancho')
  assert.equal(conEdicion.acento, 'Otro')
  assert.equal(conEdicion.texto, 'Apoyo')
  const sinTitulo = conCapas(
    { ...base, capas },
    capas.filter((c) => c.rol !== 'titulo')
  )
  assert.equal(sinTitulo.titulo, undefined, 'borrar la capa del titular lo quita también de la revisión')
  assert.equal(sinTitulo.texto, 'Apoyo')
  // Una capa añadida a mano (sin rol) no cambia el titular.
  const extra = conCapas({ ...base, capas }, [...capas, capaNueva('texto', capas)])
  assert.equal(extra.titulo, 'Gancho')
})

test('capasConTextos: una variante nueva (titular/texto) llega a las capas con rol y deja el resto como estaba', () => {
  const base = leerSpec({ layout: 'texto', titulo: 'Viejo', texto: 'Apoyo' }).spec
  const capas = [...capasDeSpec(base), capaNueva('emoji', [])]
  const nueva = capasConTextos({ ...base, capas, titulo: 'Nuevo', acento: 'Nuevo', texto: 'Otro apoyo' })
  assert.equal(nueva.capas.find((c) => c.rol === 'titulo').texto, 'Nuevo')
  assert.equal(nueva.capas.find((c) => c.rol === 'titulo').acento, 'Nuevo')
  assert.equal(nueva.capas.find((c) => c.rol === 'texto').texto, 'Otro apoyo')
  assert.equal(nueva.capas.at(-1).tipo, 'emoji')
  assert.equal(capasConTextos(base), base, 'sin capas devuelve la misma especificación')
})
