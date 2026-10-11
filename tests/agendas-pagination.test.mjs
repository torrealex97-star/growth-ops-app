import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const page = readFileSync(join(root, 'app/[tenant]/crm/agendas/page.tsx'), 'utf8')

test('la agenda no pierde filas al superar el límite de 1.000 de Supabase', () => {
  assert.ok(page.includes('const APPOINTMENTS_PAGE_SIZE = 500'), 'usa lotes acotados')
  assert.ok(page.includes('const loadAllAppointments = async () =>'), 'centraliza la lectura paginada')
  assert.ok(
    page.includes(".order('appointment_datetime', { ascending: false })") &&
      page.includes(".order('id', { ascending: false })"),
    'pagina con orden total y determinista'
  )
  assert.ok(
    page.includes('query.range(from, from + APPOINTMENTS_PAGE_SIZE - 1)'),
    'avanza por rangos inclusivos sin huecos'
  )
  assert.ok(page.includes('if (batch.length < APPOINTMENTS_PAGE_SIZE)'), 'termina solo en la última página')
})

test('cada página conserva tenant, rol y scope de colaborador', () => {
  const helper = page.slice(page.indexOf('const loadAllAppointments'), page.indexOf('// Consulta auxiliar de ventas'))
  assert.ok(helper.includes(".eq('tenant_id', tenantId)"), 'todas las páginas quedan acotadas al tenant')
  assert.ok(helper.includes("query.eq('closer_id', userId)"), 'mantiene scope propio de closer')
  assert.ok(helper.includes("query.eq('setter_id', userId)"), 'mantiene scope propio de setter')
  assert.ok(helper.includes("query.in('contact_id', collaboratorContactIds)"), 'mantiene scope de colaborador')
})
