import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { leerFiltros, sqlAgendas, sqlVentas, LIMITE_MAXIMO } from '../lib/mcp/consultas.ts'
import { esConsultaSoloLectura } from '../lib/mcp/sql-executor.ts'

const ok = (a) => leerFiltros(a).filtros

test('los filtros se validan: fechas reales AAAA-MM-DD, estado [a-z_], límite acotado', () => {
  assert.deepEqual(ok({}), { desde: null, hasta: null, estado: null, limite: 50 })
  assert.equal(ok({ limite: 9999 }).limite, LIMITE_MAXIMO)
  assert.equal(ok({ limite: -5 }).limite, 1)
  assert.equal(ok({ limite: 'x' }).limite, 50)
  assert.equal(leerFiltros({ desde: '2026-13-40' }).ok, false)
  assert.equal(leerFiltros({ desde: '2026-02-30' }).ok, false)
  assert.equal(leerFiltros({ hasta: "2026-10-01'; drop table x;--" }).ok, false)
  assert.equal(leerFiltros({ estado: "x' or '1'='1" }).ok, false)
  assert.equal(leerFiltros({ estado: 'Scheduled' }).ok, false)
  assert.equal(leerFiltros({ desde: '2026-10-10', hasta: '2026-10-01' }).ok, false)
  assert.equal(leerFiltros({ desde: 20261001 }).ok, false)
})

test('el SQL generado es de solo lectura, acotado y sin columnas pesadas ni sensibles', () => {
  const f = ok({ desde: '2026-10-01', hasta: '2026-10-26', estado: 'scheduled', limite: 10 })
  for (const sql of [sqlAgendas(f), sqlVentas(f), sqlAgendas(ok({})), sqlVentas(ok({}))]) {
    assert.equal(esConsultaSoloLectura(sql), true)
    assert.match(sql, /limit \d+$/)
    assert.doesNotMatch(
      sql,
      /raw_payload|transcript|ai_analysis|payment_proof|student_document|payer_data|access_email/
    )
  }
  assert.match(sqlAgendas(f), /a\.status = 'scheduled'/)
  assert.match(sqlVentas(f), /s\.sale_date >= '2026-10-01'::date/)
})

test('el listado de ventas expone el estado de la reserva para respetar D8 (sin totales calculados)', () => {
  const sql = sqlVentas(ok({}))
  assert.match(sql, /reservation_completed_at/)
  assert.doesNotMatch(sql, /\bsum\(|\bavg\(|\bcount\(/i)
  const ruta = readFileSync('app/api/mcp/route.ts', 'utf8')
  assert.match(ruta, /una reserva sin completar \(reservation_completed_at nulo\) no cuenta como venta/)
})

test('las herramientas nuevas están registradas como solo lectura', () => {
  const ruta = readFileSync('app/api/mcp/route.ts', 'utf8')
  for (const t of ['list_appointments', 'list_sales']) assert.match(ruta, new RegExp(`name: '${t}'`))
  assert.equal((ruta.match(/annotations: \{/g) ?? []).length, 8)
})

test('el límite también se acepta como texto numérico («10»), pero no como basura', () => {
  assert.equal(ok({ limite: '10' }).limite, 10)
  assert.equal(ok({ limite: ' 25 ' }).limite, 25)
  assert.equal(ok({ limite: '500' }).limite, LIMITE_MAXIMO)
  assert.equal(ok({ limite: '10; drop' }).limite, 50)
})

import { leerCanal, sqlConversaciones } from '../lib/mcp/consultas.ts'

test('list_conversations: solo la ficha, filtros validados y sin mensajes ni eventos', () => {
  const sql = sqlConversaciones(ok({ estado: 'abierta', limite: 20 }), 'instagram')
  assert.equal(esConsultaSoloLectura(sql), true)
  assert.match(sql, /cv\.status = 'abierta'/)
  assert.match(sql, /cv\.channel = 'instagram'/)
  assert.doesNotMatch(sql, /conversation_messages|conversation_events|\bbody\b|\bsummary\b/)
  assert.equal(leerCanal({ canal: "ig' or '1'='1" }).ok, false)
  assert.equal(leerCanal({ canal: 'Instagram' }).ok, false)
  assert.deepEqual(leerCanal({}), { ok: true, canal: null })
})

test('la migración da a mcp_reader SELECT solo sobre conversations (no mensajes ni eventos)', () => {
  const m = readFileSync('supabase/migrations/20261027100000_mcp_reader_conversaciones.sql', 'utf8')
  assert.match(m, /GRANT SELECT ON TABLE public\.conversations TO mcp_reader/)
  assert.doesNotMatch(m, /GRANT[^;]*conversation_(messages|events)/)
  assert.doesNotMatch(m, /GRANT (INSERT|UPDATE|DELETE|ALL)/i)
})

test('hay 8 herramientas MCP, todas anotadas como solo lectura', () => {
  const ruta = readFileSync('app/api/mcp/route.ts', 'utf8')
  assert.match(ruta, /name: 'list_conversations'/)
  assert.equal((ruta.match(/annotations: \{/g) ?? []).length, 8)
})
