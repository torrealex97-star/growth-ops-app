import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

// Regla «un error de carga no es un estado vacío» (PR #505, barrido 14-oct) — APICACIÓN AL PANEL
// DE DATA HEALTH. El panel leía GET /dedupe y GET /settings/data-health con:
//   · json().catch(() => null) + `if (resp.ok && payload)` — un 500 o un cuerpo roto se saltaba
//     en SILENCIO: la sección «Duplicados detectados» desaparecía (se pinta SOLO con grupos) y la
//     salud operativa se quedaba congelada, sin aviso. «Fuente ilegible» era indistinguible de
//     «todo al día».
// Ahora el estado se lee POR CONTRATO (igual que interpretarRespuestaFuturas): 200 con los campos
// esperados = legible; lo demás = aviso visible con detalle y reintentar. Congelado aquí:
//   1. la interpretación de legibilidad vive en load() mirando los ARRAYS esperados, no cualquierpayload;
//   2. el fallo se PINTA con reintentar;
//   3. el catch → null sigue existiendo pero ya no produce «vacío feliz».

const src = leer('components/settings/DataHealthPanel.tsx')

test('la legibilidad del dedupe se decidió por el contrato (arrays esperados), no por presence', () => {
  // Edge case real: el cuerpo del 500 { error } sin arrays debe caer en aviso — no en vacío.
  assert.match(src, /legibleDedupe/, 'no hay variable de legibilidad por contrato')
  assert.match(src, /Array\.isArray\(dedupePayload\.contactGroups\)/, 'no valida contactGroups')
  assert.match(src, /Array\.isArray\(dedupePayload\.appointmentGroups\)/, 'no valida appointmentGroups')
  // la rama del fallo SETEA el estado (no lo silencia)
  assert.match(src, /setDedupeError\(/, 'el fallo de dedupe no declara el estado')
})

test('un 200 con cuerpo roto en la salud operativa tampoco pinta «todo al día»', () => {
  assert.match(src, /legibleOperacional/, 'la salud operativa se lee sin comprobar el contrato')
  assert.match(src, /'integrity' in operationalPayload/, 'falta la validación del campo que la UI usa')
})

test('el aviso de fuente ilegible llega a la pantalla con reintentar', () => {
  assert.match(src, /\{dedupeError && \(/, 'el error no llega a pintarse')
  assert.match(src, /Reintentar/, 'sin salida para quien lo ve')
})

test('la sección de duplicados ya no es «invisible cuando la fuente falla»', () => {
  // Antes: (contactGroups.length > 0 || appointmentGroups.length > 0) && (<section>) — era la
  // ÚNICA puerta de la sección; con la fuente caída quedaba «sin duplicados» sin más. Ahora
  // hay un aviso dedicado ANTES de esa puerta.
  const idxAviso = src.indexOf('{dedupeError && (')
  const idxSeccion = src.indexOf('(contactGroups.length > 0 || appointmentGroups.length > 0)')
  assert.ok(idxAviso >= 0 && idxSeccion > idxAviso, 'el aviso debe preceder a la puerta de la sección')
})

test('el estado se resetea al recargar (reintentar vuelve a interpretar, no acusa en falso)', () => {
  const bloqueLoad = src.slice(src.indexOf('const load = useCallback'), src.indexOf('useEffect(() => {'))
  assert.match(bloqueLoad, /setDedupeError\(null\)/, 'el aviso persiste entre recargas')
})
