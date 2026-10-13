import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = (p) => readFileSync(join(raiz, p), 'utf8')

// ---------------------------------------------------------------------------
// Contrato del módulo: es la regla de AGENTS.md "el primero se queda". El
// backfill reutiliza registrarToque, así que aquí se verifican los GUARDS del
// propio módulo (qué filas toca y sobre qué se decide) y el typo del contrato.
// ---------------------------------------------------------------------------

test('el backfill reutiliza registrarToque (atibuirDesdePayload), NO escribe a mano', () => {
  const src = leer('lib/contacts/backfill-atribucion.ts')
  assert.match(src, /atribuirDesdePayload/, 'usa el helper canónico (first-wins live dentro)')
  assert.doesNotMatch(src, /\.insert\(\{[^}]*first_utm_source/, 'no crea filas a mano sin pasar por registrarToque')
  assert.doesNotMatch(src, /first_utm_source:\s*[^,\n]+,\s*\n\s*first_utm_medium:/, 'no upsert con first_* crudo')
})

test('no sobrescribe origen: contactos con utm ya guardado quedan fuera de los objetivos', () => {
  const src = leer('lib/contacts/backfill-atribucion.ts')
  assert.match(src, /conOrigen\.has\(r\.contact_id\)\) continue/, 'guard EXPLÍCITO: fila con dato no se toca')
})

test('idempotente entre pasadas: limit + contadores y rows_written en el outcome', () => {
  const src = leer('lib/contacts/backfill-atribucion.ts')
  assert.match(src, /Math\.min\(opts\.limite/, 'hard limit de filas por pasada')
  const route = leer('app/api/[tenant]/evergreen/settings/integraciones/history-sync/route.ts')
  assert.match(route, /rowsWritten: r\.toquesCreados \+ r\.toquesActualizados/, 'rows_written refleja lo escrito')
})

test('el proveedor "atribucion" entra por el MISMO estrecho que el resto del histórico', () => {
  const route = leer('app/api/[tenant]/evergreen/settings/integraciones/history-sync/route.ts')
  assert.match(route, /body\.provider === 'atribucion'/)
  assert.match(route, /recordSyncRun/, 'queda en el historial de sincronizaciones')
  assert.match(route, /backfillAtribucionLocal/, 'delega en el módulo en vez de duplicar la lógica')
})

test('la cita fuente es la MÁS ANTIGUA del contacto con utm (el primero manda)', () => {
  const src = leer('lib/contacts/backfill-atribucion.ts')
  assert.match(src, /order\('appointment_datetime', \{ ascending: true \}\)/, 'la más antigua primero')
  assert.match(
    src,
    /primerToquePorContacto\.has\(r\.contact_id\)\) primerToquePorContacto\.set/,
    'solo la primera cita se guarda'
  )
})

test('el payload vacío no produce toque: sin utm no se escribe nada', () => {
  const src = leer('lib/contacts/backfill-atribucion.ts')
  assert.match(src, /sinDatos\+\+/, 'cuenta sinDatos sin escribir')
  assert.match(src, /!toque\.utmSource && !toque\.utmCampaign && !toque\.utmContent/, 'guard de payload vacío')
})
