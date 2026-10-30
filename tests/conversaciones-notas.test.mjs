import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { limpiarNota, MAX_NOTA, mencionar } from '../lib/conversaciones/notas.ts'

const EQUIPO = [
  { id: 'u-ana', nombre: 'Ana María' },
  { id: 'u-anita', nombre: 'Anita' },
  { id: 'u-beto', nombre: 'Beto' },
]

test('limpiarNota: recorta bordes y rechaza lo vacío, lo no texto y lo demasiado largo', () => {
  assert.equal(limpiarNota('  hola  '), 'hola')
  assert.equal(limpiarNota('   '), null)
  assert.equal(limpiarNota(42), null)
  assert.equal(limpiarNota(null), null)
  assert.equal(limpiarNota({ texto: 'hola' }), null)
  assert.equal(limpiarNota('a'.repeat(MAX_NOTA)), 'a'.repeat(MAX_NOTA))
  assert.equal(limpiarNota('a'.repeat(MAX_NOTA + 1)), null)
})

test('mencionar: marca @Nombre completos del equipo, sin importar mayúsculas', () => {
  const { tokens, userIds } = mencionar(' habla @Ana María y luego @beto', EQUIPO)
  assert.deepEqual(userIds, ['u-ana', 'u-beto'])
  // El texto que no menciona queda intacto y en orden.
  assert.equal(tokens.map((t) => t.texto).join(''), ' habla @Ana María y luego @beto')
  const marcados = tokens.filter((t) => t.userId)
  assert.equal(marcados.length, 2)
  assert.equal(marcados[0].texto, '@Ana María')
  assert.equal(marcados[0].userId, 'u-ana')
  assert.equal(marcados[1].texto, '@beto')
  assert.equal(marcados[1].userId, 'u-beto')
})

test('mencionar: el nombre más largo gana (Ana María no se come como Ana) y faltar nombre de equipo deja texto plano', () => {
  const { userIds } = mencionar('@Ana María confirmó', EQUIPO)
  assert.deepEqual(userIds, ['u-ana'])

  const solo = mencionar('@desconocido no es del equipo', EQUIPO)
  // Un @ que no casa con nadie se queda como texto, sin marca: nada de menciones inventadas.
  assert.equal(solo.userIds.length, 0)
  assert.equal(solo.tokens.length, 1)
  assert.equal(solo.tokens[0].texto, '@desconocido no es del equipo')
  assert.equal(solo.tokens[0].userId, undefined)
})

test('mencionar: sin texto no hay tokens; sin equipo la nota queda como un solo bloque', () => {
  assert.deepEqual(mencionar('', EQUIPO), { tokens: [], userIds: [] })
  const { tokens, userIds } = mencionar('@Beto está fuera', [])
  assert.deepEqual(userIds, [])
  assert.deepEqual(tokens, [{ texto: '@Beto está fuera' }])
  // La misma persona mencionada dos veces aporta UN id.
  const dobles = mencionar('@Beto pasó y @beto repitió', EQUIPO)
  assert.deepEqual(dobles.userIds, ['u-beto'])
})

test('la migración de notas aísla por subcuenta, limita la lectura por rol y no deja escribir directamente', () => {
  const sql = readFileSync('supabase/migrations/20261030100000_conversaciones_notas.sql', 'utf8')
  assert.match(sql, /alter table public\.conversation_notes enable row level security/)
  assert.match(sql, /"conversation_notes_tenant_isolation" on public\.conversation_notes as restrictive/)
  // La lectura es SOLO para roles de gestión (más cerrada que los mensajes: nota sobre el propio equipo).
  assert.match(sql, /\(select public\.get_my_role\(\)\) in \('admin', 'director', 'manager', 'marketing', 'setter'\)/)
  assert.match(sql, /revoke insert, update, delete on public\.conversation_notes from authenticated;/)
  // FK en cascada: borrar la conversación borra las notas.
  assert.match(sql, /references public\.conversations\(id\) on delete cascade/)
})
