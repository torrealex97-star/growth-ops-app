import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import {
  activacionCompleta,
  CABECERA_SECRETO,
  CLAVE_SECRETO,
  EVENTOS_WEBHOOK,
  pasosActivacion,
  RUTA_WEBHOOK,
  rutaWebhook,
} from '../lib/launch/conexion.ts'
import { WEBHOOKS_ENTRANTES } from '../lib/webhooks/entrantes.ts'

const estados = (e) => pasosActivacion(e).map((p) => p.estado)
const base = { calendario: [], activo: null, secretoConfigurado: false, ultimoEvento: null, leads: 0 }

test('subcuenta nueva: solo el primer paso toca ahora, el resto espera', () => {
  assert.deepEqual(estados(base), ['ahora', 'pendiente', 'pendiente', 'pendiente'])
})

test('cada paso avanza con su dato real y solo uno queda como «ahora»', () => {
  const programado = { ...base, calendario: [{ estado: 'programado' }] }
  assert.deepEqual(estados(programado), ['hecho', 'ahora', 'pendiente', 'pendiente'])
  const abierto = { ...programado, activo: { label: 'Evento' } }
  assert.deepEqual(estados(abierto), ['hecho', 'hecho', 'ahora', 'pendiente'])
  const conectado = { ...abierto, secretoConfigurado: true }
  assert.deepEqual(estados(conectado), ['hecho', 'hecho', 'hecho', 'ahora'])
  const probado = { ...conectado, ultimoEvento: '2026-11-10T10:00:00Z' }
  assert.deepEqual(estados(probado), ['hecho', 'hecho', 'hecho', 'hecho'])
  assert.equal(activacionCompleta(pasosActivacion(probado)), true)
  assert.equal(activacionCompleta(pasosActivacion(conectado)), false)
})

test('un paso posterior hecho no esconde uno anterior que falta', () => {
  // Secreto guardado de antemano pero sin lanzamiento abierto: lo que toca es abrir.
  const e = { ...base, calendario: [{ estado: 'programado' }], secretoConfigurado: true }
  assert.deepEqual(estados(e), ['hecho', 'ahora', 'hecho', 'pendiente'])
})

test('un secreto que no se pudo comprobar no se da por configurado ni por ausente', () => {
  const e = { ...base, calendario: [{ estado: 'abierto' }], activo: { label: 'E' }, secretoConfigurado: null }
  const paso = pasosActivacion(e).find((p) => p.id === 'conectar')
  assert.equal(paso.estado, 'ahora')
  assert.match(paso.detalle, /No se pudo comprobar/)
})

test('un lead apuntado prueba la conexión aunque el registro de eventos no se haya podido leer', () => {
  const e = { ...base, calendario: [{ estado: 'abierto' }], activo: { label: 'E' }, secretoConfigurado: true, leads: 3 }
  assert.deepEqual(estados(e), ['hecho', 'hecho', 'hecho', 'hecho'])
})

test('las cuatro direcciones salen montadas y el slug no puede inyectar ruta ni query', () => {
  assert.deepEqual(
    EVENTOS_WEBHOOK.map((e) => rutaWebhook('mi-subcuenta', e)),
    [
      '/api/mi-subcuenta/evergreen/webhooks/lanzamiento',
      '/api/mi-subcuenta/evergreen/webhooks/lanzamiento?evento=encuesta',
      '/api/mi-subcuenta/evergreen/webhooks/lanzamiento?evento=confirmacion',
      '/api/mi-subcuenta/evergreen/webhooks/lanzamiento?evento=desconfirmacion',
    ]
  )
  assert.equal(rutaWebhook('a/b?x=1', EVENTOS_WEBHOOK[0]), '/api/a%2Fb%3Fx%3D1/evergreen/webhooks/lanzamiento')
  assert.equal(EVENTOS_WEBHOOK.filter((e) => e.obligatorio).length, 1, 'solo el alta es imprescindible')
})

test('la pantalla de Lanzamientos y el catálogo de Integraciones hablan del MISMO webhook', () => {
  const catalogo = WEBHOOKS_ENTRANTES.find((w) => w.id === 'lanzamiento')
  assert.ok(catalogo)
  assert.equal(catalogo.path, RUTA_WEBHOOK)
  assert.equal(catalogo.auth.nombre, CABECERA_SECRETO)
  assert.equal(catalogo.auth.configKey, CLAVE_SECRETO)
  const ruta = `app${RUTA_WEBHOOK.replace('{tenant}', '[tenant]')}/route.ts`
  assert.ok(existsSync(ruta), `la ruta ${ruta} existe`)
  // Los eventos que se ofrecen para copiar son exactamente los que el motor acepta.
  const motor = readFileSync('lib/launch/webhook.ts', 'utf8')
  for (const e of EVENTOS_WEBHOOK) assert.match(motor, new RegExp(`'${e.id}'`), `el motor conoce «${e.id}»`)
})

test('el motor del webhook y la pantalla usan la misma clave de secreto y la misma fuente', () => {
  const motor = readFileSync('lib/launch/webhook.ts', 'utf8')
  assert.match(motor, new RegExp(`CLAVE_SECRETO = '${CLAVE_SECRETO}'`))
  assert.match(motor, /SOURCE = 'ghl-launch'/)
})

test('la ruta de conexión nunca devuelve el secreto ni su longitud', () => {
  const ruta = readFileSync('app/api/[tenant]/evergreen/lanzamiento/conexion/route.ts', 'utf8')
  assert.match(ruta, /secretoConfigurado = Boolean\(cfg\[CLAVE_SECRETO\]\)/)
  assert.doesNotMatch(ruta, /\.length/)
  assert.match(ruta, /requirePantalla\(tenant, '\/lanzamiento'\)/)
})

test('las rutas que gestionan lanzamientos usan el guard único, no una lista de roles propia', () => {
  for (const f of ['route.ts', 'contenido/route.ts', 'checklist/route.ts', 'informe/guardados/route.ts']) {
    const src = readFileSync(`app/api/[tenant]/evergreen/lanzamiento/${f}`, 'utf8')
    assert.match(src, /puedeGestionarLanzamiento\(auth\)/, f)
    assert.doesNotMatch(src, /\['admin', 'director'\]\.includes\(auth\.role/, f)
  }
})

test('un error de acción no puede desmontar el panel: carga y acción no comparten estado', () => {
  const page = readFileSync('app/[tenant]/lanzamiento/page.tsx', 'utf8')
  assert.match(page, /errorCarga/)
  assert.doesNotMatch(page, /!loading && !error && data/)
  assert.match(page, /toast\.error\(j\.error/)
})
