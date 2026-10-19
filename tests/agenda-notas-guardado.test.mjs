import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const detalle = readFileSync('components/appointments/AppointmentDetail.tsx', 'utf8')
const agendas = readFileSync('app/[tenant]/crm/agendas/page.tsx', 'utf8')
const seguimiento = readFileSync('app/[tenant]/crm/seguimiento/page.tsx', 'utf8')

test('guardar notas avisa a la pantalla para que la lista y la agenda abierta no se queden con el valor viejo', () => {
  assert.match(detalle, /onFieldsSaved\?\.\(appointment\.id, \{\s*notes: notes\.trim\(\) \|\| null/)
  // También al deshacer, al guardar la transcripción y al guardar el enlace antes de analizar.
  assert.ok((detalle.match(/onFieldsSaved\?\./g) ?? []).length >= 4)
})

test('las dos pantallas que abren el detalle actualizan su estado con lo guardado', () => {
  for (const src of [agendas, seguimiento]) {
    assert.match(src, /onFieldsSaved=\{handleFieldsSaved\}/)
    assert.match(src, /const handleFieldsSaved = \(id: string, campos: Partial<AppointmentWithRelations>\)/)
    assert.match(src, /setSelectedAppointment\(\(prev\) => \(prev \? \{ \.\.\.prev, \.\.\.campos \} : prev\)\)/)
  }
})

test('lo escrito se guarda solo al salir del campo, para que cerrar la agenda sin pulsar Guardar no lo pierda', () => {
  assert.match(detalle, /onBlur=\{\(\) => \{\s*if \(dirty && !savingNote\) void saveNote\(true\)/)
  assert.match(detalle, /const saveNote = async \(silent = false\)/)
  // El guardado silencioso no lanza confeti ni ofrece deshacer.
  assert.match(detalle, /if \(silent\) \{\s*toast\.success\('Notas guardadas'\)\s*return\s*\}/)
})
