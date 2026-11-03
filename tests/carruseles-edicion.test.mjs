import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { conTextosEditados, textosEditables } from '../lib/carruseles/historias/edicion.ts'
import { ALTO_MINIMO_BLOQUE, leerSpec, posicionPx, renderHistoria } from '../lib/carruseles/historias/layouts.ts'
import { leerSpecDeHtml } from '../lib/carruseles/historias/pedidos.ts'
import { DEFAULT_BRAND } from '../lib/carruseles/types.ts'

const html = `<style>.a{color:red}</style><div class="a"><h1> Hola &amp; adiós </h1><p>Segunda <b>frase</b></p><img src="x.png" alt="no editable"><script>var t = "no"</script></div>`

test('se listan solo los textos visibles (no estilos, scripts ni atributos) y se decodifican', () => {
  assert.deepEqual(textosEditables(html), [
    { indice: 0, texto: 'Hola & adiós' },
    { indice: 1, texto: 'Segunda' },
    { indice: 2, texto: 'frase' },
  ])
})

test('editar un texto deja todo lo demás idéntico, conserva los espacios y escapa el HTML', () => {
  const nuevo = conTextosEditados(html, { 0: 'Nuevo <título> & más', 2: 'palabra' })
  assert.match(nuevo, /<h1> Nuevo &lt;título&gt; &amp; más <\/h1>/)
  assert.match(nuevo, /<p>Segunda <b>palabra<\/b><\/p>/)
  assert.ok(nuevo.startsWith('<style>.a{color:red}</style>') && nuevo.includes('<script>var t = "no"</script>'))
  assert.equal(conTextosEditados(html, {}), html, 'sin cambios, idéntico')
})

test('texto editado y vuelto a leer da el mismo texto (ida y vuelta)', () => {
  const t = 'A & B <c> "d" \'e\''
  assert.equal(textosEditables(conTextosEditados(html, { 1: t }))[1].texto, t)
})

test('una historia con especificación se edita por campos: la posición libre mueve el bloque y se guarda en la spec', () => {
  const r = leerSpec({ layout: 'foto_texto', texto: 'Hola', posicion: 500 })
  assert.equal(r.spec.posicion, 94, 'la posición se acota a la zona segura')
  assert.equal(leerSpec({ layout: 'foto_texto', texto: 'Hola', posicion: -3 }).spec.posicion, 6)
  const ctx = { brand: DEFAULT_BRAND, estilo: 'nativo', media: [], hoy: new Date(2026, 10, 3), indice: 1, total: 5 }
  const h = renderHistoria({ ...r.spec, posicion: 50 }, ctx)
  assert.match(h, new RegExp(`ig-zona-libre[^"]*" style="--ig-top:${posicionPx(50)}px"`))
  assert.doesNotMatch(
    renderHistoria(r.spec, ctx).replace(/posicion[^,]*,/, ''),
    /ig-zona-abajo/,
    'con posición ya no usa la zona fija'
  )
  assert.equal(leerSpecDeHtml(h).spec.posicion, 50, 'la posición viaja en la especificación incrustada')
  assert.ok(
    posicionPx(0) >= 250 && posicionPx(100) + ALTO_MINIMO_BLOQUE <= 1920 - 340,
    'el bloque siempre cabe en la zona segura'
  )
  assert.ok(posicionPx(0, 'tiktok') >= 234, 'ni en TikTok puede subir sobre la cabecera (fecha y logo)')
  assert.ok(posicionPx(100, 'tiktok') + ALTO_MINIMO_BLOQUE <= 1920 - 480)
})

test('el renderizador funciona en el navegador: no importa módulos de servidor', () => {
  for (const f of ['layouts', 'pedidos', 'edicion', 'fecha']) {
    const src = readFileSync(`lib/carruseles/historias/${f}.ts`, 'utf8')
    assert.doesNotMatch(src, /@anthropic-ai|from '\.\.\/system-prompt'|from '\.\.\/ejemplos'|supabase|node:/)
  }
})

test('cambiar de plantilla desde el editor rellena lo que la nueva exige y siempre queda válida', async () => {
  const { conLayout, LAYOUTS } = await import('../lib/carruseles/historias/layouts.ts')
  const base = { layout: 'foto_texto', texto: 'Hola' }
  for (const l of LAYOUTS) {
    const s = conLayout(base, l)
    assert.equal(s.layout, l)
    assert.ok(leerSpec(s).ok, `${l} debe ser válida tras el cambio: ${leerSpec(s).error}`)
  }
  assert.equal(
    conLayout({ layout: 'texto', texto: 'x', items: [{ titulo: 'a' }] }, 'comparacion').items.length,
    1,
    'no pisa lo que ya había'
  )
})

test('el visor es editable sin IA: arrastra el texto, suelta fotos y guarda por la API de slides', () => {
  const v = readFileSync('components/carruseles/VisorEditable.tsx', 'utf8')
  assert.match(v, /role="slider"/, 'el asa de arrastre es accesible y se mueve con el teclado')
  assert.match(v, /ArrowUp[\s\S]*ArrowDown/)
  assert.match(v, /slides\/\$\{slide\.id\}/)
  assert.doesNotMatch(v, /\/chat|completeText|anthropic/i)
  const r = readFileSync('components/carruseles/ReferenceImages.tsx', 'utf8')
  assert.match(r, /TIPO_ARRASTRE_MEDIO/)
  assert.match(r, /draggable=\{!img\.pedido\}/, 'el material real no se arrastra como fondo')
})

test('revisión de la secuencia: gancho, tiempo de lectura, cierre con acción, ritmo y material', async () => {
  const { revisarSecuencia, segundosDeLectura } = await import('../lib/carruseles/historias/revision.ts')
  const s = (o) => ({ layout: 'foto_texto', texto: 'Una frase corta', ...o })
  const buena = [
    s({ layout: 'portada', titulo: 'El mayor error que veo', acento: 'error', texto: undefined }),
    s({ layout: 'texto' }),
    s({ layout: 'comparacion', items: [{ titulo: 'a' }, { titulo: 'b' }], texto: undefined }),
    s({ layout: 'sticker', sticker: { tipo: 'escribe' }, texto: undefined }),
  ]
  assert.deepEqual(revisarSecuencia(buena, { hayMedios: true, pendientes: 0 }), [])

  const largo = 'palabra '.repeat(30).trim()
  const mala = [
    s({ layout: 'portada', titulo: largo }),
    s({ texto: largo }),
    s({ texto: 'a' }),
    s({ texto: 'b 🔥🔥🔥' }),
  ]
  const m = revisarSecuencia(mala, { hayMedios: false, pendientes: 2 }).map((x) => `${x.nivel}:${x.historia}`)
  assert.ok(m.includes('error:null'), 'material pendiente es error')
  assert.ok(m.includes('aviso:1'), 'gancho largo / sin acento')
  assert.ok(m.includes('aviso:2'), 'texto largo')
  assert.ok(m.includes('aviso:4'), 'emojis y cierre sin acción')
  assert.ok(m.includes('aviso:null'), 'sin fotos')
  assert.equal(segundosDeLectura(s({ texto: largo })), 11)
  assert.equal(revisarSecuencia([], { hayMedios: true, pendientes: 0 }).length, 0)
  const tres = [0, 1, 2, 3].map(() => s({}))
  assert.ok(revisarSecuencia(tres, { hayMedios: true, pendientes: 0 }).some((x) => /misma plantilla/.test(x.mensaje)))
})

test('variantes con IA: el prompt lleva el modo y el contexto, y la respuesta se lee aunque venga sucia', async () => {
  const { construirPromptVariantes, leerVariantes } = await import('../lib/carruseles/historias/variantes.ts')
  const spec = { layout: 'portada', titulo: 'El mayor error', texto: 'Y nadie lo dice' }
  const p = construirPromptVariantes({
    modo: 'ganchos',
    spec,
    resto: ['Otra idea'],
    contexto: 'Vendemos formación',
    posicion: 1,
    total: 5,
  })
  assert.match(p.user, /Historia 1 de 5 \(plantilla portada\)/)
  assert.match(p.user, /3 GANCHOS/)
  assert.match(p.user, /«Otra idea»/)
  assert.match(p.user, /Vendemos formación/)
  assert.match(p.system, /No inventes cifras/)
  assert.match(construirPromptVariantes({ modo: 'corta', spec, resto: [], posicion: 2, total: 5 }).user, /más CORTAS/)

  const sucia =
    'Aquí tienes:\n```json\n[{"titulo":"Todos fallan aquí","acento":"fallan","texto":"x"},{"titulo":"Otro","acento":"inexistente"},{"foo":1},{"titulo":"c"},{"titulo":"d"}]\n```\nSuerte'
  const v = leerVariantes(sucia)
  assert.equal(v.length, 3, 'máximo 3 y se descartan las vacías')
  assert.equal(v[0].acento, 'fallan')
  assert.equal(v[1].acento, undefined, 'el acento debe aparecer en el titular')
  assert.deepEqual(leerVariantes('no hay json'), [])
  assert.deepEqual(leerVariantes('[{roto'), [])
})

test('la ruta de variantes exige sesión, limita la frecuencia, solo propone y no guarda', () => {
  const r = readFileSync('app/api/[tenant]/evergreen/carruseles/variantes/route.ts', 'utf8')
  assert.match(r, /getCarruselUser\(\)/)
  assert.match(r, /limitar\(`variantes:\$\{t\.tenantId\}`/)
  assert.match(r, /getProject\(t\.tenantId/)
  assert.doesNotMatch(r, /updateSlide|addSlide/, 'no escribe: la persona decide')
})

test('plataforma: TikTok cambia los márgenes de la interfaz, la posición libre y viaja en la especificación', async () => {
  const { SEGURA_POR_PLATAFORMA } = await import('../lib/carruseles/historias/estilo-nativo.ts')
  const ctx = { brand: DEFAULT_BRAND, estilo: 'nativo', media: [], hoy: new Date(2026, 10, 3), indice: 1, total: 5 }
  const ig = renderHistoria({ layout: 'foto_texto', texto: 'Hola' }, ctx)
  const tt = renderHistoria({ layout: 'foto_texto', texto: 'Hola', plataforma: 'tiktok' }, ctx)
  assert.doesNotMatch(ig, /--ig-seg-abajo/, 'Instagram usa los márgenes por defecto del CSS')
  assert.match(tt, new RegExp(`--ig-seg-abajo:${SEGURA_POR_PLATAFORMA.tiktok.abajo}px`))
  assert.ok(SEGURA_POR_PLATAFORMA.tiktok.abajo > SEGURA_POR_PLATAFORMA.instagram.abajo, 'TikTok tapa más abajo')
  assert.ok(posicionPx(100, 'tiktok') < posicionPx(100, 'instagram'), 'la posición libre respeta la zona de TikTok')
  assert.equal(leerSpecDeHtml(tt).spec.plataforma, 'tiktok')
  assert.equal(leerSpec({ layout: 'texto', texto: 'x', plataforma: 'myspace' }).spec.plataforma, undefined)
  const rec = readFileSync('lib/carruseles/recomponer.ts', 'utf8')
  assert.match(rec, /opciones\.plataforma/)
  assert.match(
    readFileSync('app/api/[tenant]/evergreen/carruseles/chat/route.ts', 'utf8'),
    /hist\.plataforma === 'tiktok'/
  )
})

test('de idea a historias: la idea abre el creador con el tema escrito y el visor muestra revisión, guías y variantes', () => {
  assert.match(
    readFileSync('app/[tenant]/marketing/ideas/page.tsx', 'utf8'),
    /instagram\/carruseles\?nuevo=historias&tema=/
  )
  const lista = readFileSync('app/[tenant]/instagram/carruseles/page.tsx', 'utf8')
  assert.match(lista, /params\.get\('nuevo'\) === 'historias'/)
  assert.match(readFileSync('components/carruseles/CreateProjectDialog.tsx', 'utf8'), /temaInicial/)
  const v = readFileSync('components/carruseles/VisorEditable.tsx', 'utf8')
  for (const t of ['Revisión de la secuencia', 'Guías de la app', 'Variantes con IA', 'aria-label="Publicar en"'])
    assert.ok(v.includes(t), t)
})

test('revisión: la llamada a la acción se detecta por palabras enteras («admito» no es «dm»)', async () => {
  const { revisarSecuencia } = await import('../lib/carruseles/historias/revision.ts')
  const s = (texto, o = {}) => ({ layout: 'foto_texto', texto, ...o })
  const base = [s('Uno', { layout: 'portada', titulo: 'Gancho corto', acento: 'corto' }), s('Dos'), s('Tres')]
  const sinAccion = revisarSecuencia([...base, s('Lo admito, me equivoqué')], { hayMedios: true, pendientes: 0 })
  assert.ok(
    sinAccion.some((h) => /no pide una acción/.test(h.mensaje)),
    '«admito» no cuenta como «dm»'
  )
  for (const t of ['Escribe CLOSER', 'Mándame un DM', 'Guárdalo']) {
    const conAccion = revisarSecuencia([...base, s(t)], { hayMedios: true, pendientes: 0 })
    assert.ok(!conAccion.some((h) => /no pide una acción/.test(h.mensaje)), t)
  }
})

test('la posición libre no puede subir sobre la cabecera: arranca debajo de la fecha y el logo en ambas redes', async () => {
  const { SEGURA_POR_PLATAFORMA, CSS_NATIVO } = await import('../lib/carruseles/historias/estilo-nativo.ts')
  const CABECERA_FIN = 104 + 130 // top de .ig-cabecera + alto de la etiqueta de fecha
  for (const p of ['instagram', 'tiktok']) assert.ok(SEGURA_POR_PLATAFORMA[p].arriba >= CABECERA_FIN, p)
  assert.match(
    CSS_NATIVO,
    /\.ig-zona\.ig-zona-libre\{top:var\(--ig-top\)/,
    'la posición es el borde superior, sin translateY(-50%)'
  )
  assert.doesNotMatch(CSS_NATIVO, /ig-zona-libre\{transform/)
})

test('el formulario del visor solo se recarga al cambiar de slide o por cambios ajenos, nunca por lecturas de lo que guardamos', async () => {
  const { debeRecargarFormulario } = await import('../lib/carruseles/historias/sincronia.ts')
  const guardados = new Set(['A1', 'A2'])
  const r = (formId, slideId, html) => debeRecargarFormulario({ formId, slideId, html, guardados })
  assert.equal(r('A', 'A', 'A1'), false, 'lectura de algo que guardamos: no se recarga')
  assert.equal(r('A', 'A', 'A1-ya-superado'), true, 'cambio ajeno (p. ej. la IA): se recarga')
  assert.equal(
    r('B', 'A', 'A1'),
    true,
    'volver a A desde B: el formulario era el de B, se recarga aunque A1 sea nuestro'
  )
  assert.equal(r(null, 'A', 'A2'), true, 'primera carga')
  assert.equal(r('A', 'A', 'A2'), false, 'lectura tardía de un guardado anterior mientras ya hay otro más nuevo')
  const v = readFileSync('components/carruseles/VisorEditable.tsx', 'utf8')
  assert.match(v, /debeRecargarFormulario\(/)
  assert.match(v, /pendiente\.current\?\.\(true\)/, 'al salir se guarda lo pendiente')
  assert.match(v, /keepalive: opciones\.alSalir === true/, 'keepalive solo al salir (límite de 64 KiB)')
  assert.match(
    v,
    /sinVersion: versionadas\.current\.has\(slide\.id\)/,
    'el autoguardado no llena el historial de deshacer'
  )
  assert.match(v, /variantes\.slideId === slide\.id/, 'las variantes solo se ofrecen en la historia que las pidió')
  assert.match(v, /conSpec\[h\.historia - 1\]/, 'los avisos se traducen al número real de slide')
  assert.match(v, /onPointerCancel/)
})
