import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { cssDeFamilia, cssDeFuentes, vaciarCacheFuentes } from '../lib/carruseles/fuentes.ts'
import { FAMILIAS_NATIVAS } from '../lib/carruseles/historias/estilo-nativo.ts'

test.beforeEach(() => vaciarCacheFuentes())

const resp = (ok, cuerpo = '') => ({ ok, text: async () => cuerpo })
const FACE = '@font-face{font-family:X;src:url(x.woff2)}'

test('si Google rechaza los pesos pedidos (400), reintenta con menos pesos hasta dar con CSS válido', async () => {
  const urls = []
  const f = async (url) => {
    urls.push(url)
    // DM Serif Display solo existe en 400: cualquier petición con pesos falla.
    return url.includes('wght@') ? resp(false, '<html>400</html>') : resp(true, FACE)
  }
  const css = await cssDeFamilia('DM Serif Display', f)
  assert.equal(css, FACE)
  assert.equal(urls.length, 3, 'prueba 300-900, luego 400;700 y por último sin pesos')
  assert.match(urls[2], /family=DM%20Serif%20Display&display=swap/)
})

test('una respuesta 200 sin @font-face no se acepta; sin ningún CSS válido devuelve vacío', async () => {
  assert.equal(await cssDeFamilia('X', async () => resp(true, '<html>nada</html>')), '')
  assert.equal(
    await cssDeFamilia('X', async () => {
      throw new Error('red')
    }),
    ''
  )
})

test('varias familias: se piden por separado, se deduplican y un fallo no tumba las demás', async () => {
  const f = async (url) => (url.includes('Roto') ? resp(false) : resp(true, FACE))
  const css = await cssDeFuentes(['Anton', ' Anton ', 'Roto', 'Newsreader', ''], f)
  assert.equal(css.split('@font-face').length - 1, 2, 'Anton (una vez) y Newsreader')
})

test('se limita el número de familias por petición', async () => {
  let n = 0
  await cssDeFuentes(
    Array.from({ length: 40 }, (_, i) => `F${i}`),
    async () => (n++, resp(true, FACE))
  )
  assert.ok(n <= 12)
})

test('la exportación incluye las fuentes nativas en historias 9:16 y el proxy usa el helper', () => {
  assert.deepEqual(FAMILIAS_NATIVAS.sort(), ['Anton', 'DM Serif Display', 'Newsreader', 'Space Mono'])
  const exp = readFileSync('lib/carruseles/export-client.ts', 'utf8')
  assert.match(exp, /aspectRatio === '9:16'/)
  const ruta = readFileSync('app/api/[tenant]/evergreen/carruseles/fonts/route.ts', 'utf8')
  assert.match(ruta, /cssDeFuentes/)
  assert.doesNotMatch(ruta, /wght@300;400;500;600;700;800;900/)
})

test('el CSS de una familia se cachea: la segunda exportación no repite las peticiones; los fallos no se cachean', async () => {
  let n = 0
  const f = async (url) => (n++, url.includes('wght@') ? resp(false) : resp(true, FACE))
  await cssDeFamilia('Anton', f)
  const tras1 = n
  await cssDeFamilia('Anton', f)
  assert.equal(n, tras1, 'segunda llamada servida desde la caché')
  let m = 0
  const roto = async () => (m++, resp(false))
  await cssDeFamilia('Roto', roto)
  const tras = m
  await cssDeFamilia('Roto', roto)
  assert.ok(m > tras, 'un fallo se reintenta (no queda fijado)')
})
