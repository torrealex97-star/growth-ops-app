import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ESTADOS_COLABORADOR_ASIGNABLES } from '../lib/collaborators/estados-asignables.ts'

test('un colaborador recién invitado se puede asignar; suspendido/inactivo no', () => {
  assert.ok(ESTADOS_COLABORADOR_ASIGNABLES.includes('invited'))
  assert.ok(ESTADOS_COLABORADOR_ASIGNABLES.includes('pending_contract'))
  assert.ok(ESTADOS_COLABORADOR_ASIGNABLES.includes('active'))
  assert.ok(!ESTADOS_COLABORADOR_ASIGNABLES.includes('suspended'))
  assert.ok(!ESTADOS_COLABORADOR_ASIGNABLES.includes('inactive'))
})

test('ficha y API usan la fuente única, sin listas de estados propias', () => {
  const ficha = readFileSync('app/[tenant]/crm/contactos/[id]/page.tsx', 'utf8')
  const api = readFileSync('app/api/[tenant]/evergreen/colaboradores/attribution/route.ts', 'utf8')
  assert.match(ficha, /ESTADOS_COLABORADOR_ASIGNABLES/)
  assert.match(api, /ESTADOS_COLABORADOR_ASIGNABLES/)
  assert.doesNotMatch(ficha, /\['active', 'pending_contract'\]/)
  assert.doesNotMatch(api, /\['active', 'pending_contract'\]/)
})
