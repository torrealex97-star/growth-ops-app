import { CSS_NATIVO } from '../lib/carruseles/historias/estilo-nativo.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { esVideoUrl, tipoDeMedio } from '../lib/carruseles/almacen.ts'
import {
  estiloPorDefecto,
  estiloValido,
  estilosDe,
  fuentesDeMarca,
  marcaConColores,
  seccionEstiloPrompt,
} from '../lib/carruseles/estilos.ts'
import { ETAPAS } from '../lib/carruseles/historias/categorias.ts'
import {
  LAYOUTS,
  elegirMedio,
  fondoLiso,
  leerSpec,
  renderHistoria,
  veloDe,
} from '../lib/carruseles/historias/layouts.ts'
import { extractFontFamilies } from '../lib/carruseles/slide-html.ts'
import { DEFAULT_BRAND } from '../lib/carruseles/types.ts'

const marca = {
  ...DEFAULT_BRAND,
  name: 'Demo',
  colors: { ...DEFAULT_BRAND.colors, primary: '#101820', accent: '#e11d74' },
  fonts: { heading: 'Poppins', body: 'Lora' },
  logoUrl: 'https://cdn.example.test/logo.png',
}
const foto = { url: 'https://cdn.example.test/a.jpg', kind: 'image', name: 'a.jpg' }
const video = { url: 'https://cdn.example.test/b.mp4', kind: 'video', name: 'b.mp4' }
const ctx = (o = {}) => ({
  brand: marca,
  estilo: 'nativo',
  media: [foto],
  hoy: new Date(2026, 10, 3),
  indice: 1,
  total: 5,
  ...o,
})
const spec = (o) => {
  const r = leerSpec({ layout: 'foto_texto', texto: 'Hola', ...o })
  assert.ok(r.ok, r.error)
  return r.spec
}

test('cada etapa del arco apunta a una plantilla que existe', () => {
  for (const e of Object.values(ETAPAS)) assert.ok(LAYOUTS.includes(e.layout))
})

test('validación: layout desconocido, historia sin texto y campos obligatorios por plantilla', () => {
  assert.equal(leerSpec({ layout: 'inventada', texto: 'x' }).ok, false)
  assert.equal(leerSpec({ layout: 'texto' }).ok, false, 'sin ningún texto')
  assert.equal(leerSpec({ layout: 'comparacion', titulo: 'x' }).ok, false)
  assert.equal(leerSpec({ layout: 'sticker', titulo: 'x' }).ok, false)
  assert.equal(leerSpec({ layout: 'cifra', titulo: 'x' }).ok, false)
  const largo = leerSpec({ layout: 'texto', titulo: 'a'.repeat(500) })
  assert.ok(largo.ok && largo.spec.titulo.length <= 110, 'el titular se acota')
  assert.equal(
    spec({ items: [{ titulo: 'a' }, { titulo: 'b' }, { titulo: 'c' }], layout: 'comparacion' }).items.length,
    2
  )
})

test('el texto se escapa: la IA no puede inyectar HTML en la historia', () => {
  const h = renderHistoria(spec({ texto: '<img src=x onerror=alert(1)> & "hola"' }), ctx())
  assert.doesNotMatch(h, /<img src=x/)
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt; &amp; &quot;hola&quot;/)
})

test('la app decide la foto: portada limpia, texto oscurecido, y liso cuando no hay fotos o se pide', () => {
  assert.match(renderHistoria(spec({ layout: 'portada', titulo: 'T' }), ctx()), /ig-velo-20/)
  assert.match(renderHistoria(spec({ layout: 'texto' }), ctx()), /ig-velo-75/)
  const sin = renderHistoria(spec({ layout: 'texto' }), ctx({ media: [] }))
  assert.doesNotMatch(sin, /ig-velo|<img class="ig-foto"/, 'sin fotos: fondo liso, sin velo')
  assert.match(sin, new RegExp(`background:${fondoLiso(marca)}`))
  assert.doesNotMatch(renderHistoria(spec({ fondo: 'liso' }), ctx()), /<img class="ig-foto"/)
})

test('el velo cambia con el estilo: «limpio» deja ver más la foto', () => {
  assert.ok(veloDe('texto', 'limpio') < veloDe('texto', 'nativo'))
  assert.equal(veloDe('portada', 'limpio'), 0)
})

test('nada se pisa: la fecha y el logo van en la cabecera y el contenido en una única zona segura', () => {
  const h = renderHistoria(spec({ layout: 'portada', titulo: 'Gancho', fecha: true }), ctx({ indice: 0 }))
  assert.match(h, /<div class="ig-cabecera"><div class="ig-etiqueta-fecha"><span>3<\/span><span>nov\.<\/span>/)
  assert.equal((h.match(/class="ig-zona /g) ?? []).length, 1)
  assert.ok(h.indexOf('ig-cabecera') < h.indexOf('ig-zona'))
  assert.doesNotMatch(
    h.slice(h.indexOf('ig-zona')),
    /ig-etiqueta-fecha|ig-logo/,
    'ni fecha ni logo dentro de la zona de texto'
  )
})

test('el logo sale en la primera, la última y (estilo marca) en todas; las tipografías y el acento son los de la marca', () => {
  assert.match(renderHistoria(spec({}), ctx({ indice: 0 })), /class="ig-logo"/)
  assert.doesNotMatch(renderHistoria(spec({}), ctx({ indice: 2 })), /class="ig-logo"/)
  assert.match(renderHistoria(spec({ ultima: true }), ctx({ indice: 2 })), /class="ig-logo"/)
  assert.match(renderHistoria(spec({}), ctx({ indice: 2, estilo: 'marca' })), /class="ig-logo"/)
  const h = renderHistoria(spec({}), ctx({ estilo: 'marca' }))
  assert.match(h, /--ig-acento:#e11d74/)
  assert.match(h, /--ig-f-titulo:&#39;Poppins&#39;/)
  assert.doesNotMatch(
    renderHistoria(spec({}), ctx()),
    /--ig-f-titulo/,
    'fuera del estilo de marca el texto usa las tipografías de Instagram'
  )
  assert.equal(fuentesDeMarca(DEFAULT_BRAND), null, 'marca sin configurar: tipografías del estilo nativo')
})

test('los vídeos se reproducen de fondo (mudos y en bucle) y el gancho prefiere el vídeo', () => {
  const h = renderHistoria(spec({ layout: 'portada', titulo: 'T' }), ctx({ indice: 0, media: [foto, video] }))
  assert.match(h, /<video class="ig-foto" src="https:\/\/cdn\.example\.test\/b\.mp4" muted loop autoplay playsinline/)
  assert.equal(
    elegirMedio(spec({ foto: 1, layout: 'portada' }), ctx({ indice: 0, media: [foto, video] })),
    foto,
    'foto pedida a mano'
  )
  assert.equal(esVideoUrl('https://x/y.MOV?v=1'), true)
  assert.equal(tipoDeMedio('https://x/y.jpg'), 'image')
})

test('comparación, sticker, cifra y partida se componen con sus piezas', () => {
  assert.match(
    renderHistoria(
      spec({
        layout: 'comparacion',
        items: [
          { icono: '❌', titulo: 'Antes' },
          { icono: '✅', titulo: 'Ahora' },
        ],
      }),
      ctx()
    ),
    /ig-recuadro.*Antes.*ig-recuadro.*Ahora/s
  )
  assert.match(
    renderHistoria(spec({ layout: 'sticker', sticker: { tipo: 'escribe', cabecera: 'CLOSER' } }), ctx()),
    /ig-sticker-escribe">CLOSER/
  )
  assert.match(renderHistoria(spec({ layout: 'cifra', cifra: '+37%' }), ctx()), /ig-cifra">\+37%/)
  assert.match(renderHistoria(spec({ layout: 'partida', titulo: 'T' }), ctx({ media: [foto, video] })), /ig-partida/)
  assert.doesNotMatch(
    renderHistoria(spec({ layout: 'partida', titulo: 'T' }), ctx({ media: [foto] })),
    /ig-partida/,
    'con una sola foto, composición normal'
  )
})

test('los estilos cambian la composición, no la marca', () => {
  assert.deepEqual(estilosDe(true), ['nativo', 'editorial', 'limpio', 'marca'])
  assert.deepEqual(estilosDe(false), ['disenado', 'foto', 'minimal', 'marca'])
  assert.equal(estiloValido('nativo', false), 'disenado', 'un estilo de historias no vale en un carrusel')
  assert.equal(estiloValido('disenado', true), 'nativo')
  assert.equal(estiloPorDefecto(false), 'disenado')
  const t = spec({ texto: 'Frase' })
  assert.match(renderHistoria(t, ctx({ estilo: 'nativo' })), /ig-caja-negra/)
  assert.match(renderHistoria(t, ctx({ estilo: 'marca' })), /ig-caja-acento/)
  assert.match(renderHistoria(t, ctx({ estilo: 'limpio' })), /ig-franja/)
  assert.doesNotMatch(renderHistoria(t, ctx({ estilo: 'editorial' })), /ig-caja/)
  assert.match(
    seccionEstiloPrompt({
      opciones: { estilo: 'marca', fotosDeFondo: true },
      esHistorias: true,
      brand: marca,
      fotos: [],
    }),
    /Mantén siempre colores/
  )
  assert.equal(marcaConColores(DEFAULT_BRAND), false)
  assert.equal(marcaConColores(marca), true)
})

test('las tipografías de marca puestas en variables CSS se detectan para cargarlas y exportarlas', () => {
  assert.deepEqual(extractFontFamilies(`<div style="--ig-f-titulo:'Poppins';--ig-f-cuerpo:'Lora'"></div>`).sort(), [
    'Lora',
    'Poppins',
  ])
})

test('el texto usa las tipografías y los fondos de caja del editor de Instagram', () => {
  assert.match(renderHistoria(spec({}), ctx()), /ig-zona ig-zona-abajo ig-f-classic/)
  assert.match(renderHistoria(spec({ fuente: 'typewriter' }), ctx()), /ig-f-typewriter/)
  assert.match(renderHistoria(spec({ estilo: 'editorial' }), ctx({ estilo: 'editorial' })), /ig-f-serif/)
  assert.doesNotMatch(
    renderHistoria(spec({}), ctx({ estilo: 'marca' })),
    /ig-f-(classic|modern|neon|typewriter|strong|serif)/,
    'estilo de marca: tipografías de la marca'
  )
  assert.match(renderHistoria(spec({ fondoTexto: 'sin' }), ctx()), /<div class="ig-texto">Hola/)
  assert.match(renderHistoria(spec({ fondoTexto: 'solido', colorTexto: 'negro' }), ctx()), /ig-caja-solida-negra/)
  assert.match(renderHistoria(spec({ fondoTexto: 'solido' }), ctx()), /class="ig-caja"/)
  assert.match(renderHistoria(spec({ fondoTexto: 'translucido', colorTexto: 'blanco' }), ctx()), /ig-caja-vidrio/)
  assert.equal(
    leerSpec({ layout: 'texto', texto: 'x', fuente: 'comic' }).spec.fuente,
    undefined,
    'fuente desconocida se ignora'
  )
  assert.match(CSS_NATIVO, /\.ig-f-neon :is\([^)]*\)\{font-family:'Quicksand'/)
  assert.match(CSS_NATIVO, /\.ig-f-strong :is\([^)]*\)\{font-family:'Anton'[^}]*uppercase/)
})

test('los emojis son texto Unicode (los pinta la fuente de emojis del dispositivo, la de Apple en iPhone/Mac)', () => {
  const h = renderHistoria(spec({ texto: '✅ Así 🔥' }), ctx())
  assert.match(h, /✅ Así 🔥/)
  assert.doesNotMatch(h, /twemoji|emoji\.png|<svg/i, 'sin imágenes ni SVG de emojis')
})

test('historias y carruseles son productos separados: tipo por formato, formulario y estilos propios', async () => {
  const { tipoDeProyecto } = await import('../lib/carruseles/tipos.ts')
  assert.equal(tipoDeProyecto({ kind: 'carousel', aspectRatio: '9:16' }), 'historias')
  assert.equal(tipoDeProyecto({ kind: 'carousel', aspectRatio: '4:5' }), 'carrusel')
  assert.equal(tipoDeProyecto({ kind: 'flyer', aspectRatio: '9:16' }), 'flyer', 'un flyer vertical no es una historia')
  const dlg = (await import('node:fs')).readFileSync('components/carruseles/CreateProjectDialog.tsx', 'utf8')
  assert.match(dlg, /historias: \['9:16'\]/)
  assert.match(dlg, /carrusel: \['4:5', '1:1'\]/, 'un carrusel ya no ofrece el formato de historia')
})
