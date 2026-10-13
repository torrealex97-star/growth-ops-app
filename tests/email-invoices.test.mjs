import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const ROUTE = 'app/api/[tenant]/evergreen/facturas-email/route.ts'
const SQL = 'supabase/migrations/20260913180000_email_invoices.sql'

// La regla que no se negocia: nada llega a contabilidad por sí solo.
test('una factura importada nace pendiente de validación y sin gasto vinculado', () => {
  const sql = read(SQL)
  assert.match(sql, /status\s+TEXT NOT NULL DEFAULT 'pendiente_validacion'/)
  // La constraint lo impide incluso si el código se equivocara.
  assert.match(sql, /email_invoices_validation_coherent/)
  assert.match(
    sql,
    /status = 'pendiente_validacion' AND validated_at IS NULL AND validated_by IS NULL AND expense_id IS NULL/
  )

  const route = read(ROUTE)
  // El sync NO escribe el status: lo pone la base, así que no puede colar una validada.
  const insert = route.slice(
    route.indexOf(".from('email_invoices')\n          .insert("),
    route.indexOf(".select('id')")
  )
  assert.doesNotMatch(insert, /status:/, 'el sync no debe fijar el status al importar')
  assert.doesNotMatch(insert, /expense_id/, 'el sync no debe vincular un gasto')
})

// Dos claves, porque protegen de cosas distintas.
test('el esquema histórico conserva dedupe por ocurrencia y contenido', () => {
  const sql = read(SQL)
  assert.match(sql, /email_invoices_occurrence_key[\s\S]*\(tenant_id, provider, message_id, attachment_id\)/)
  assert.match(sql, /email_invoices_content_key[\s\S]*\(tenant_id, sha256\)/)
})

test('no se extrae el importe ni se adivinan datos fiscales', () => {
  const client = read('lib/gmail/client.ts')
  const route = read(ROUTE)
  // Deducir un importe del asunto o del nombre del archivo daría números plausibles y falsos, y el
  // destino es la contabilidad.
  for (const señal of [/amount/i, /importe/i, /total/i, /\bIVA\b/, /\bCIF\b/]) {
    assert.doesNotMatch(client.replace(/\/\/[^\n]*/g, ''), señal, `el cliente parece extraer ${señal}`)
    assert.doesNotMatch(route.replace(/\/\/[^\n]*/g, ''), señal, `el sync parece extraer ${señal}`)
  }
  // Y no se llama a ningún modelo para ello.
  assert.doesNotMatch(client, /anthropic|claude|openai/i)
  assert.doesNotMatch(route, /anthropic|claude|openai/i)
})

test('el escaneo Gmail queda retirado sin perder el histórico', () => {
  const route = read(ROUTE)
  assert.match(route, /export async function POST\(\)/)
  assert.match(route, /status: 410/)
  assert.match(route, /Sube o reenvía la factura/)
  assert.doesNotMatch(route, /getAttachmentBytes|listMessageIds|gmail\.googleapis/)
  assert.match(route, /export async function GET/)
  assert.match(route, /export async function PATCH/)
})

test('validar y descartar exigen rol de gestión y comprueban la subcuenta', () => {
  const route = read(ROUTE)
  const patch = route.slice(route.indexOf('export async function PATCH'))
  assert.match(patch, /requireManage\(tenant\)/)
  assert.match(patch, /eq\('tenant_id', session\.tenantId\)/)
  assert.match(patch, /data\.length === 0/)
  // Descartar no puede dejar un gasto atado.
  assert.match(patch, /body\.status === 'validada' \? body\.expenseId \|\| null : null/)
})

test('la gestoría puede leer el buzón pero no escribirlo', () => {
  const sql = read(SQL)
  assert.match(sql, /email_invoices_select_finance[\s\S]*gestoria/)
  assert.match(sql, /email_invoices_admin_write[\s\S]*is_admin_or_director\(\)/)
  assert.match(sql, /AS RESTRICTIVE FOR ALL/)
})
