import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { anexarMotivoDescualificacion } from '../lib/agenda/notas.ts'

const leer = (p) => readFileSync(p, 'utf8')

test('el motivo de descualificación se añade a las notas del closer, no las sustituye', () => {
  assert.equal(
    anexarMotivoDescualificacion('Objeción: precio. Llamar el lunes.', 'Lead falso'),
    'Objeción: precio. Llamar el lunes.\n\nDescualificado: Lead falso'
  )
})

test('sin notas previas solo queda el motivo, y repetirlo no lo duplica', () => {
  assert.equal(anexarMotivoDescualificacion(null, 'Sin teléfono'), 'Descualificado: Sin teléfono')
  const una = anexarMotivoDescualificacion('Nota', 'X')
  assert.equal(anexarMotivoDescualificacion(una, 'X'), una)
})

test('un motivo vacío no toca las notas', () => {
  assert.equal(anexarMotivoDescualificacion('Nota importante', '   '), 'Nota importante')
  assert.equal(anexarMotivoDescualificacion(undefined, ''), '')
})

test('la ruta de etapa de seguimiento añade el motivo en vez de reemplazar las notas', () => {
  const r = leer('app/api/[tenant]/evergreen/appointments/followup-stage/route.ts')
  assert.match(r, /update\.notes = anexarMotivoDescualificacion\(appt\.notes, reason\)/)
  assert.doesNotMatch(r, /update\.notes = reason\.trim\(\)/)
})

test('Seguimiento descarta el borrador al guardar y cuando la nota cambia desde otro sitio', () => {
  const p = leer('app/[tenant]/crm/seguimiento/page.tsx')
  assert.match(p, /const limpiarBorrador = /)
  // Tras guardar la nota
  assert.match(p, /notes: draft\.trim\(\) \} : a\)\)\)\s+limpiarBorrador\(appointmentId\)/)
  // Cuando el detalle de la agenda guarda notas
  assert.match(p, /if \('notes' in campos\) limpiarBorrador\(id\)/)
  // Usa las notas finales que devuelve el servidor
  assert.match(p, /typeof json\?\.notes === 'string'/)
})
