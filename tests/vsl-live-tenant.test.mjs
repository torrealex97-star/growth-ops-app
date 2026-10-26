import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// Code review 26-oct (VSL): regresiones de las correcciones aplicadas.
// 1) la prueba social pública no mezcla subcuentas, 2) el latido acota la entrada del cliente,
// 3) el join de heatmaps usa el índice (tenant_id, playback_id).
// Añadidos 27-oct (review profundo): 4) el % visto en contacts respeta la subcuenta,
// 5) el viewer_id del playback usa el anonId saneado, 6) identify lleva rate limit.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (path) => readFileSync(join(root, path), 'utf8')
const live = read('app/api/vsl/live/[slug]/route.ts')
const player = read('components/vsl/VslPlayer.tsx')
const track = read('app/api/vsl/track/route.ts')
const session = read('app/api/vsl/session/route.ts')
const metrics = read('app/api/[tenant]/evergreen/vsl/metrics/[slug]/route.ts')
const tracking = read('lib/vsl/tracking.ts')
const sync = read('lib/vsl/sync.ts')
const identify = read('app/api/vsl/identify/route.ts')

test('prueba social: con ?tenant= se filtra por la subcuenta (el slug de vídeo NO es único global)', () => {
  // El contador va siempre filtrado por la subcuenta declarada en la query.
  assert.match(live, /JOIN tenants t ON t\.id = v\.tenant_id/, 'la ruta con tenant filtra el tenant')
  assert.match(live, /AND t\.slug = \$\{tenantQuery\}/, 'filtro por slug de subcuenta')
  // El player manda el tenant: es el vídeo que ya conoce.
  assert.match(
    player,
    /\/api\/vsl\/live\/\$\{video\.slug\}\?tenant=\$\{encodeURIComponent\(video\.tenant\)\}/,
    'el player manda su subcuenta en la prueba social'
  )
})

test('prueba social: SIN tenant, una colisión de slug falla cerrado (ceros, no otra subcuenta)', () => {
  assert.match(live, /SELECT DISTINCT v\.tenant_id FROM vsl_videos/, 'cuenta los dueños del slug')
  assert.match(live, /\(Number\(owners\?\.owners\) \|\| 0\) > 1/, 'colisión detectada')
  assert.match(live, /watching: 0, watched: 0/, 'colisión → ceros cerrados (un hueco no es un cero)')
})

test('el tope de vídeo es un único sanitizador compartido y EXPORTADO, no constantes copiadas', () => {
  assert.match(tracking, /export const MAX_VIDEO_SECONDS = 86_400/)
  // No puede quedar una copia privada del mismo tope dentro del módulo.
  assert.doesNotMatch(tracking, /^(?!export)const MAX_VIDEO_SECONDS/m, 'no hay duplicado privado del tope')
})

test('el latido de tracking acota TODO lo que el cliente manda: seconds, position y duration', () => {
  // El array de seconds por latido acota como los intervalos (240 entradas) y no crece sin límite.
  assert.match(track, /\.slice\(0, 240\)/, 'seconds por latido acotado')
  assert.match(track, /MAX_VIDEO_SECONDS/, 'debe usar el tope compartido')
  // position y duration no pueden inflar columnas (max_position, duration) con valores absurdos.
  assert.match(
    track,
    /const position = Math\.min\(Math\.max\(Number\(body\.position\) \|\| 0, 0\), MAX_VIDEO_SECONDS\)/
  )
  assert.match(
    track,
    /const duration = Math\.min\(Math\.max\(Number\(body\.duration\) \|\| 0, 0\), MAX_VIDEO_SECONDS\)/
  )
})

test('la sesión recorta los campos del cliente antes de entrar en filas (anonId, referrer y UA)', () => {
  assert.match(session, /const localAnonId = typeof anonId === 'string' \? anonId\.trim\(\)\.slice\(0, 200\) : null/)
  assert.match(session, /referrer\.slice\(0, 500\)/, 'referrer acotado')
  assert.match(session, /req\.headers\.get\('user-agent'\) \|\| ''\)\.slice\(0, 400\)/, 'user-agent acotado')
})

test('el % visto en contacts solo toca la subcuenta de la sesión (email compartido ≠ escribir en otros tenants)', () => {
  // syncContactWatchPct exige tenant_id: un UPDATE por email a secas podía escribir el
  // porcentaje de una sesión de una subcuenta sobre contactos de otra que compartan email.
  assert.match(
    sync,
    /WHERE tenant_id = \$\{sess\.tenant_id\} AND lower\(email\) = \$\{sess\.lead_email\}/,
    'el UPDATE lleva tenant_id'
  )
  assert.match(sync, /if \(!sess\?\.tenant_id \|\| !sess\.lead_email\) return/, 'sin subcuenta no escribe nada')
  // Los dos únicos llamantes pasan una sesión con tenant_id (RETURNING del UPDATE de vsl_sessions).
  assert.match(track, /RETURNING tenant_id, lead_email, max_position, duration/)
  assert.match(identify, /RETURNING id, tenant_id, lead_email, max_position, duration/)
})

test('el viewer_id del playback es el anonId saneado, no el texto crudo del cliente', () => {
  // vsl_viewer_identities enlaza viewer_id con contactos: si el INSERT guardara el anonId sin
  // recortar, el enlace identify→contacto podría recibir un valor distinto al usado por metrics.
  assert.match(session, /\$\{localAnonId\}, now\(\), now\(\)/, 'viewer_id = localAnonId saneado')
  assert.doesNotMatch(session, /viewer_id.*\$\{anonId\}(?![\)"])/, 'el anonId crudo no entra en INSERT')
})

test('identify también lleva rate limit (rutas públicas VSL: session, track e identify)', () => {
  assert.match(identify, /MinuteRateLimiter/)
  assert.match(identify, /limiter\.allow\(`vsl-identify:\$\{ip\}`, 60\)/)
  assert.match(session, /limiter\.allow\(`vsl-session:\$\{ip\}`, 60\)/)
  assert.match(track, /limiter\.allow\(`vsl-track:\$\{ip\}`, 120\)/)
})

test('el heatmaps JOIN usa el índice compuesto (tenant_id, playback_id, …)', () => {
  // El índice de vsl_watch_intervals es (tenant_id, playback_id, start_second, end_second):
  // filtrar solo por playback_id no lo aprovecha a medida que la tabla crece.
  assert.match(
    metrics,
    /INNER JOIN vsl_watch_intervals interval\s+ON interval\.tenant_id = recent\.tenant_id AND interval\.playback_id = recent\.playback_id/
  )
  // recent debe exponer el tenant_id para ese join.
  assert.match(
    metrics,
    /SELECT p\.playback_id, p\.started_at, p\.ended_at, p\.viewer_id, p\.legacy_session_id,\s+p\.tenant_id/
  )
})
