import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { MAX_IMAGEN, MAX_VIDEO, rutaValida, validarArchivo } from '../lib/carruseles/almacen.ts'
import { seccionEstiloPrompt } from '../lib/carruseles/estilos.ts'
import { subirDirecto } from '../lib/carruseles/subida-cliente.ts'
import { DEFAULT_BRAND } from '../lib/carruseles/types.ts'

test('validación de archivos: tipo por carpeta y tope de tamaño (15 MB imagen, 50 MB vídeo)', () => {
  assert.equal(validarArchivo('image/jpeg', 8 * 1024 * 1024, 'referencias'), null, 'una foto de móvil de 8 MB vale')
  assert.equal(validarArchivo('video/mp4', MAX_VIDEO, 'referencias'), null)
  assert.match(validarArchivo('video/mp4', MAX_VIDEO + 1, 'referencias'), /50 MB/)
  assert.match(validarArchivo('image/png', MAX_IMAGEN + 1, 'referencias'), /15 MB/)
  assert.match(validarArchivo('video/mp4', 1000, 'ejemplos'), /Formato/, 'los ejemplos son solo imágenes')
  assert.match(validarArchivo('image/svg+xml', 1000, 'referencias'), /Formato/, 'el SVG solo vale para logos')
  assert.equal(validarArchivo('image/svg+xml', 1000, 'marca'), null)
  assert.match(validarArchivo('image/png', 0, 'marca'), /vacío/)
  assert.match(validarArchivo('application/pdf', 10, 'marca'), /Formato/)
})

test('solo se registran rutas que el servidor entregó para esa subcuenta y carpeta', () => {
  const id = '3f2b8c1e-9d4a-4e6f-8a10-1b2c3d4e5f60'
  assert.equal(rutaValida(`acme/referencias/${id}.jpg`, 'acme', 'referencias'), true)
  assert.equal(rutaValida(`otra/referencias/${id}.jpg`, 'acme', 'referencias'), false, 'de otra subcuenta')
  assert.equal(rutaValida(`acme/ejemplos/${id}.jpg`, 'acme', 'referencias'), false, 'de otra carpeta')
  assert.equal(rutaValida(`acme/referencias/../../x/${id}.jpg`, 'acme', 'referencias'), false, 'sin saltos de ruta')
  assert.equal(rutaValida(`acme/referencias/${id}.exe`, 'acme', 'referencias'), false)
  assert.equal(rutaValida(undefined, 'acme', 'referencias'), false)
})

test('subida directa: pide la dirección, sube el archivo a ella (no a nuestras rutas) y devuelve ruta y URL', async () => {
  const llamadas = []
  const f = async (url, init) => {
    llamadas.push([url, init?.method])
    if (String(url).endsWith('/upload-url'))
      return {
        ok: true,
        json: async () => ({
          path: 'acme/referencias/x.jpg',
          url: 'https://cdn/x.jpg',
          signedUrl: 'https://storage.example/upload/sign/x?token=t',
        }),
      }
    return { ok: true, json: async () => ({}) }
  }
  const archivo = new File([new Uint8Array(10)], 'foto.jpg', { type: 'image/jpeg' })
  assert.deepEqual(await subirDirecto('acme', archivo, 'referencias', f), {
    path: 'acme/referencias/x.jpg',
    url: 'https://cdn/x.jpg',
  })
  assert.deepEqual(llamadas[1], ['https://storage.example/upload/sign/x?token=t', 'PUT'])

  const rechazo = async () => ({ ok: false, json: async () => ({ error: 'La imagen pesa más de 15 MB' }) })
  await assert.rejects(subirDirecto('acme', archivo, 'referencias', rechazo), /15 MB/)
  let n = 0
  const subidaFalla = async (u) =>
    n++ === 0
      ? { ok: true, json: async () => ({ path: 'p', url: 'u', signedUrl: 's' }) }
      : { ok: false, json: async () => ({}) }
  await assert.rejects(subirDirecto('acme', archivo, 'referencias', subidaFalla), /No se pudo subir/)
})

test('ningún cliente sube archivos por multipart a nuestras rutas (límite de ~4,5 MB de Vercel)', () => {
  for (const f of [
    'components/carruseles/ReferenceImages.tsx',
    'components/carruseles/PedidosPanel.tsx',
    'components/carruseles/BrandDialog.tsx',
    'components/carruseles/CasoExitoDialog.tsx',
    'components/carruseles/EjemplosDialog.tsx',
    'components/settings/BusinessContextCard.tsx',
  ]) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /subirDirecto\(/, f)
    assert.doesNotMatch(src, /new FormData\(\)/, f)
  }
  const ruta = readFileSync('app/api/[tenant]/evergreen/carruseles/upload-url/route.ts', 'utf8')
  assert.match(ruta, /createSignedUploadUrl/)
  assert.match(ruta, /carpeta === 'ejemplos' && !PUEDEN_EDITAR/, 'los ejemplos solo los sube liderazgo')
  assert.doesNotMatch(readFileSync('app/api/[tenant]/evergreen/carruseles/upload/route.ts', 'utf8'), /formData\(\)/)
})

test('el prompt de historias no manda escribir estilos ni HTML (lo componen las plantillas) y los ejemplos solo van en la primera generación', () => {
  const marca = { ...DEFAULT_BRAND, name: 'X', fonts: { heading: 'Poppins', body: 'Lora' } }
  const p = seccionEstiloPrompt({
    opciones: { estilo: 'marca', fotosDeFondo: true },
    esHistorias: true,
    brand: marca,
    fotos: [],
  })
  assert.doesNotMatch(p, /ig-historia|ig-impacto|style del contenedor/)
  const chat = readFileSync('app/api/[tenant]/evergreen/carruseles/chat/route.ts', 'utf8')
  assert.match(chat, /adjuntarEjemplos = project\.slides\.length === 0/)
  assert.match(chat, /guiaEstilo && adjuntarEjemplos/)
})

test('el autoguardado no llena el historial de deshacer y recomponer escribe en bloque', () => {
  assert.match(
    readFileSync('app/api/[tenant]/evergreen/carruseles/[id]/slides/[slideId]/route.ts', 'utf8'),
    /sinVersion: body\.sinVersion === true/
  )
  const store = readFileSync('lib/carruseles/store.ts', 'utf8')
  assert.match(store, /if \(!updates\.sinVersion\) slide\.previousVersions/)
  assert.match(store, /export async function updateSlides/)
  const rec = readFileSync('lib/carruseles/recomponer.ts', 'utf8')
  assert.match(rec, /updateSlides\(tenantId, projectId, cambios\)/)
  assert.doesNotMatch(rec, /updateSlide\(/, 'ya no una escritura por historia')
})
