import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261016100000_tasks_select_colaboradora.sql', 'utf8')

test('la lectura de tareas de una colaboradora queda acotada a lo suyo en la base de datos', () => {
  assert.match(sql, /DROP POLICY IF EXISTS tasks_select_team/)
  assert.match(sql, /IS DISTINCT FROM 'affiliate'/)
  assert.match(sql, /assignee_id = \(SELECT auth\.uid\(\)\)/)
  assert.match(sql, /created_by = \(SELECT auth\.uid\(\)\)/)
})

test('mantiene el aislamiento por subcuenta', () => {
  assert.match(sql, /tenant_id IN \(SELECT auth_tenant_ids\(\)\)/)
})
