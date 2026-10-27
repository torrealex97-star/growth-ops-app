// V0 — PRESERVATION GATE del módulo VSL (auditoría 22-sep, docs/VSL_MODULE_AUDIT.md).
// Fija el comportamiento ACTUAL del núcleo antes de extender nada (V1+): si algo de esto
// falla tras un cambio futuro, el cambio NO se fusiona (OLD BEHAVIOR = PASS).
// Patrón del repo: la lógica pura se replica congelada; las rutas se verifican por fuente.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const lee = (p) => readFileSync(join(root, p), 'utf8')

// ---------------------------------------------------------------------------
// 1. TRACK: dedupe de watched_seconds y saneamiento del latido (heatmap real)
// ---------------------------------------------------------------------------
test('track: fusiona segundos vistos sin duplicados, acotados y saneados', () => {
  const route = lee('app/api/vsl/track/route.ts')
  // El latido dedupea en DB con array_agg(DISTINCT) — heatmap real que tolera rebobinados.
  assert.match(route, /array_agg\(DISTINCT e ORDER BY e\)/, 'watched_seconds se fusiona sin duplicados')
  // Saneamiento antes de tocar DB: enteros >= 0, < 1 día, sin NaN.
  assert.match(route, /Number\.isFinite\(s\)/, 'descarta basura numérica')
  assert.match(
    route,
    /s >= 0 && s < MAX_VIDEO_SECONDS/,
    'acota los segundos a un rango razonable (tope compartido 24 h)'
  )
  // Nuevo en el code review 26-oct: el array entero y position/duration también quedan acotados.
  assert.match(route, /\.slice\(0, 240\)/, 'seconds por latido acotado como los intervalos')
  assert.match(route, /MAX_VIDEO_SECONDS\)/, 'position/duration acotadas al mismo tope')
  // max_position y duration solo suben (GREATEST): la retención nunca retrocede.
  assert.match(route, /GREATEST\(max_position/, 'max_position monótona creciente')
  assert.match(route, /GREATEST\(duration/, 'duration monótona creciente')
  // reached_end acumulativo y first_play_at inmutable tras la primera vez.
  assert.match(route, /reached_end\s*= reached_end OR/, 'reached_end se pega una vez vista')
  assert.match(route, /COALESCE\(first_play_at/, 'first_play_at se fija solo la primera vez')
  // Exige sessionId: sin él no hay fila que tocar.
  assert.match(route, /sessionId requerido/, 'rechaza latidos sin sesión')
})

test('track: el evento ended/unload viaja por sendBeacon (sobrevive al cierre del tab)', () => {
  const player = lee('components/vsl/VslPlayer.tsx')
  assert.match(player, /sendBeacon/, 'el player usa sendBeacon para ended/unload')
  assert.match(player, /'application\/json'/, 'el beacon viaja como JSON')
})

// ---------------------------------------------------------------------------
// 2. IDENTIFY: validación que nunca rompe el tracking de la landing
// ---------------------------------------------------------------------------
test('identify: descarta merge fields sin resolver y emails inválidos, sin lanzar', () => {
  const route = lee('app/api/vsl/identify/route.ts')
  assert.match(route, /\{\{/, 'detecta merge fields de GHL sin resolver')
  assert.match(route, /\[\^\\s@\]\+@/, 'valida la pinta del email')
  assert.match(route, /COALESCE\(\$\{cleanEmail\}, lead_email\)/, 'email nulo NO borra el existente')
  assert.match(route, /COALESCE\(\$\{cleanName\}, lead_name\)/, 'name nulo NO borra el existente')
  assert.match(route, /sessionId requerido/, 'rechaza identify sin sesión')
})

// ---------------------------------------------------------------------------
// 3. SESSION: upsert por (video_id, anon_id) con dispositivo y país
// ---------------------------------------------------------------------------
test('session: una sesión por vídeo+anon, con device/country/UA capturados', () => {
  const route = lee('app/api/vsl/session/route.ts')
  assert.match(route, /ON CONFLICT \(video_id, anon_id\)/, 'sesión única por vídeo+anon (comportamiento actual)')
  assert.match(route, /DO UPDATE SET updated_at = now\(\)/, 'el retorno refresca la sesión existente')
  assert.match(route, /referrer = COALESCE\(vsl_sessions\.referrer, EXCLUDED\.referrer\)/, 'el primer referrer gana')
  assert.match(route, /x-vercel-ip-country|cf-ipcountry/, 'país desde headers de edge')
  assert.match(route, /slug y anonId requeridos/, 'valida entrada mínima')
})

test('session: el INSERT lleva tenant_id del vídeo resuelto (regresión del 23502 que 500aba el tracking)', () => {
  const route = lee('app/api/vsl/session/route.ts')
  // Regresión 25-oct: la migración 20260911150000 declaró vsl_sessions.tenant_id NOT NULL sin
  // trigger que lo rellene; sin este valor en el INSERT solo subía al error 23502 y el tracking
  // VSL completo (sesiones, playbacks, latidos) llevaba semanas sin escribir una fila.
  assert.match(
    route,
    /INSERT INTO vsl_sessions \(tenant_id, video_id, anon_id, referrer,/,
    'la fila nace ya scoping al tenant del vídeo'
  )
  assert.match(
    route,
    /VALUES \(\$\{video\.tenant_id\}, \$\{video\.id\}, \$\{localAnonId\}/,
    'tenant_id viene del vídeo canónico (resolvePublicVsl), nunca del cliente'
  )
})

// ---------------------------------------------------------------------------
// 4. TENANT ISOLATION: toda query tenant-side lleva filtro explícito
// ---------------------------------------------------------------------------
test('tenant scoping: videos y metrics filtran tenant_id en TODAS sus consultas', () => {
  const videos = lee('app/api/[tenant]/evergreen/vsl/videos/route.ts')
  assert.match(videos, /WHERE tenant_id = \$\{auth\.tenantId\}/, 'listado filtrado por tenant')
  assert.match(videos, /AND tenant_id = \$\{auth\.tenantId\}/, 'update/delete filtrados por tenant')
  assert.match(videos, /WHERE slug = \$\{slug\} AND tenant_id/, 'chequeo de slug dentro del tenant')
  const metrics = lee('app/api/[tenant]/evergreen/vsl/metrics/[slug]/route.ts')
  // F02: además de la sesión de subcuenta, acceso a la pantalla de VSL (la ruta usa `postgres`
  // directo, que se salta RLS).
  assert.match(metrics, /requirePantalla/, 'metrics exige acceso a la pantalla de VSL')
  // La consulta de sesión de métricas une con el vídeo del tenant (no confía en el slug solo).
  assert.match(metrics, /tenant_id = \$\{tenantId\}/, 'métricas acotadas al tenant')
})

test('secrets: la API key de Bunny jamás sale del servidor', () => {
  const bunny = lee('app/api/[tenant]/evergreen/vsl/bunny/route.ts')
  // La ruta devuelve la FIRMA efímera (necesaria para TUS), nunca un campo apiKey como valor.
  assert.ok(!/apiKey\s*:/.test(bunny), 'ninguna respuesta devuelve la apiKey como campo')
  const firma = lee('lib/vsl/bunny.ts')
  assert.match(firma, /createHash\('sha256'\)/, 'firma TUS SHA256 (contrato Bunny)')
  assert.match(firma, /FIRMA_VALIDEZ_S = 6 \* 60 \* 60/, 'la firma caduca (6h)')
})

// ---------------------------------------------------------------------------
// 5. SYNC CRM: el % visto al contacto solo sube y jamás tumba el tracking
// ---------------------------------------------------------------------------
test('sync: vsl_watch_pct monótono y fallos aislados (columnas ausentes no rompen)', () => {
  const sync = lee('lib/vsl/sync.ts')
  assert.match(sync, /GREATEST\(COALESCE\(vsl_watch_pct, 0\), \$\{pct\}\)/, 'el % solo sube')
  assert.match(sync, /Math\.min\(100,/, 'acotado a 100')
  assert.match(sync, /catch \{/, 'un fallo de sync no rompe el tracking')
})

// ---------------------------------------------------------------------------
// 6. EMBED: público sin auth, pero resuelto por tenant y sin cruces entre cuentas
// ---------------------------------------------------------------------------
test('embed: sigue siendo público, lleva tenant explícito y conserva el 404 amigable', () => {
  const embed = lee('app/embed/vsl/[slug]/page.tsx')
  const dashboard = lee('components/vsl/VslDashboard.tsx')
  assert.match(embed, /resolvePublicVsl\(slug, tenant\)/, 'el embed usa la resolución pública canónica')
  assert.match(dashboard, /\?tenant=\$\{encodeURIComponent\(tenant\)\}/, 'el snippet identifica la subcuenta')
  assert.match(embed, /Vídeo no encontrado/, '404 amigable')
  assert.match(embed, /preconnect/, 'preconnect del CDN intacto')
})

test('embed/session: un slug compartido falla cerrado y nunca elige un tenant por LIMIT 1', () => {
  const resolver = lee('lib/vsl/public-video.ts')
  const session = lee('app/api/vsl/session/route.ts')
  assert.match(resolver, /INNER JOIN tenants t ON t\.id = v\.tenant_id/, 'tenant resuelto en PostgreSQL')
  assert.match(resolver, /AND t\.slug = \$\{tenant\}/, 'el lookup actual exige el slug del tenant')
  assert.match(resolver, /LIMIT 2/, 'el fallback antiguo detecta al menos una colisión')
  assert.match(resolver, /rows\.length > 1/, 'una colisión se declara ambigua')
  assert.match(session, /status === 'ambiguous'/, 'la sesión rechaza un embed antiguo ambiguo')
  assert.match(session, /status: 409/, 'la respuesta obliga a regenerar el embed')
})

test('postMessage: solo el iframe VSL y su ventana padre pueden intercambiar identidad', () => {
  const player = lee('components/vsl/VslPlayer.tsx')
  const loader = lee('app/embed/loader.js/route.ts')
  assert.match(player, /e\.source !== window\.parent/, 'el player rechaza mensajes ajenos al padre')
  assert.match(loader, /isVslFrameSource\(e\.source\)/, 'la landing rechaza ready de ventanas ajenas')
})

test('loader: el JS que se sirve COMPLILA — un deslizo de sintaxis rompe toda la landing', () => {
  // El loader es un template literal de su script: un comment sin abrir o un paréntesis de
  // más se sirve igual (200) y el navegador lo rechaza EN PÁGINA, tirando identify,
  // Calendly y el auto-capture a la vez. El test extrae el script y lo compila de verdad.
  const fuente = lee('app/embed/loader.js/route.ts')
  const desde = fuente.indexOf('const js = `')
  const hasta = fuente.indexOf('`\n', desde)
  assert.ok(desde !== -1 && hasta !== -1, 'no se encuentra el template del script')
  const js = fuente
    .slice(desde + 'const js = `'.length, hasta)
    .replace(/\$\{JSON\.stringify\(origin\)\}/g, '"https://app.scalixsystems.com"')
  assert.doesNotThrow(() => new Function(js), 'el script servido debe ser JavaScript válido')
})

test("loader: al identificar emite window.gop('lead', email) para el stitching del pixel", () => {
  const loader = lee('app/embed/loader.js/route.ts')
  // El evento de identidad del pixel es lo que escribe analytics_visitors.contact_id:
  // con el MISMO email, el visitante anónimo queda enlazado al contacto en la BD.
  assert.match(loader, /window\.gop\('lead', \{ email: email \}\)/, 'evento lead con el email')
  assert.doesNotMatch(loader, /window\.gop\('lead',[^)]*name\)/, 'el nombre NO viaja en el evento del pixel')
  // Hook DENTRO de identify (manual y auto-captura pasan por el mismo sitio) con el email
  // ya sin merge fields; y solo cuando hay email, que es la señal de identidad.
  assert.match(loader, /emitLeadPixel\(payload\.email\);\n\s+pending = payload/, 'se emite justo al identificar')
  // Sin pixel en la página es no-op (jamas rompe la landing por falta de tracker.js).
  assert.match(loader, /typeof window\.gop === 'function'/, 'guard de presencia del pixel')
  // Dedupe por email: GHL re-renderiza y vuelve a llamar identify con el mismo lead.
  assert.match(loader, /email === ultimoLead\) return/, 'no re-emite el mismo lead')
})

// ---------------------------------------------------------------------------
// 8. V1 — soft delete + rate limit (extensión segura sobre lo preservado)
// ---------------------------------------------------------------------------
test('V1: los vídeos se borran en soft (deleted_at) y todo lookup respeta los borrados', () => {
  const videos = lee('app/api/[tenant]/evergreen/vsl/videos/route.ts')
  assert.match(videos, /SET deleted_at = now\(\)/, 'DELETE lógico, no físico')
  assert.match(videos, /deleted_at IS NULL/, 'el listado excluye borrados')
  const resolver = lee('lib/vsl/public-video.ts')
  assert.match(resolver, /v\.deleted_at IS NULL/, 'embed y sesiones solo resuelven vídeos vivos')
  const session = lee('app/api/vsl/session/route.ts')
  assert.match(session, /resolvePublicVsl/, 'las sesiones reutilizan el mismo filtro de vídeos vivos')
})

test('V1: session y track llevan rate limit ( MinuteRateLimiter del pixel)', () => {
  const session = lee('app/api/vsl/session/route.ts')
  assert.match(session, /MinuteRateLimiter/, 'limitador reutilizado, no reinventado')
  assert.match(session, /429/, 'rechazo con 429')
  const track = lee('app/api/vsl/track/route.ts')
  assert.match(track, /limiter\.allow/, 'track también acotado')
})

// ---------------------------------------------------------------------------
// 7. CONFIG: mergeConfig rellena defaults — las claves nuevas no rompen vídeos viejos
// ---------------------------------------------------------------------------
test('config: mergeConfig completa los defaults de vídeos con config parcial/vieja', () => {
  const types = lee('lib/vsl/types.ts')
  assert.match(types, /export const DEFAULT_CONFIG/, 'existe DEFAULT_CONFIG')
  assert.match(types, /mergeConfig/, 'existe mergeConfig')
  // Defaults del contrato actual del player.
  for (const clave of ['autoplay', 'muted', 'lockSeek', 'fakeProgress', 'loop', 'exitHook']) {
    assert.match(types, new RegExp(clave + ':'), `default ${clave} presente`)
  }
})

// ---------------------------------------------------------------------------
// 9. MINIATURA DINÁMICA ELEGIBLE (24-oct): recorte Bunny o segmento a medida
// ---------------------------------------------------------------------------
test('config: el bucle dinámico a medida queda acotado en mergeConfig y PRESERVA el default bunny', () => {
  const types = lee('lib/vsl/types.ts')
  // Default V0-safe: un vídeo antiguo (o uno nuevo sin tocar) sigue viendo el webp de Bunny.
  assert.match(
    types,
    /animationSource: c\.animationSource === 'custom' \? 'custom' : 'bunny'/,
    'sin elección explícita, animación de Bunny (comportamiento anterior intacto)'
  )
  // Clamps: inicio saneado a >= 0 (cap 2 h) y duración del bucle 2-12 s enteros.
  assert.match(types, /Math\.min\(7200, startSeg\)/, 'inicio del bucle capado')
  assert.match(types, /Math\.min\(12, Math\.max\(2,/, 'duración del bucle 2-12 s')
})

test('player: la precarga gobernada y el bucle dinámico no tocan el tracking ni gastan red de más', () => {
  const player = lee('components/vsl/VslPlayer.tsx')
  // Precarga de la fuente solo por intención (viewport + idle), desactivada con saveData.
  assert.match(player, /prefetchStartedRef/, 'la precarga es idempotente (una sola vez)')
  assert.match(player, /startFragPrefetch: true/, 'hls.js pide el primer fragmento sin esperar el manifest')
  assert.match(player, /hlsRef\.current\?\.startLoad\(\)/, 'el play de un HLS previamente precargado arranca caliente')
  // El bucle a medida usa el vídeo REAL con buffer acotado al propio bucle (no descarga entera).
  assert.match(player, /maxBufferLength: loopLen \+ 2/, 'buffer del bucle acotado a su duración')
  assert.match(player, /loopVideoRef/, 'existe el elemento de bucle separado')
  // El bucle vive en el elemento overlay: nunca un segundo sendBeat ni una segunda sesión.
  assert.ok(!/loopVideoRef[\s\S].*sendBeat/.test(player), 'el bucle del póster no emite latidos de tracking')
})

test('biblioteca: el borrado deja de ser exclusivo del vídeo seleccionado y preserva la selección ajena', () => {
  const dashboard = lee('components/vsl/VslDashboard.tsx')
  // El borrado de otro vídeo no limpia la selección actual: solo se resetea si es el abierto.
  assert.match(
    dashboard,
    /if \(selected === video\.slug\) setSelected\(null\)/,
    'borrar otro vídeo conserva la selección actual'
  )
  assert.match(dashboard, /Borrar vídeo \$\{video\.name\}/, 'papelera accesible por ítem de la lista')
})
