import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { documentoDeContacto, literalContiene, resultadosDeBusqueda, sqlBuscar, sqlFetch } from '../lib/mcp/busqueda.ts'
import { esConsultaSoloLectura } from '../lib/mcp/sql-executor.ts'

const ruta = readFileSync('app/api/mcp/route.ts', 'utf8')

test('el texto del modelo entra como literal: comillas duplicadas y comodines escapados', () => {
  assert.equal(literalContiene("o'brien"), "'%o''brien%'")
  assert.equal(literalContiene('100%_'), "'%100\\%\\_%'")
  assert.equal(literalContiene('a\\b'), "'%a\\\\b%'")
  assert.equal(literalContiene('   \n\t '), null)
  assert.ok(literalContiene('x'.repeat(500)).length <= 110)
})

test('un intento de inyección queda dentro del literal y la consulta sigue siendo de solo lectura', () => {
  const sql = sqlBuscar("x'; drop table contacts; --")
  assert.ok(sql)
  assert.equal(esConsultaSoloLectura(sql), true)
  assert.match(sql, /ilike '%x''; drop table contacts; --%'/)
  assert.equal(sqlBuscar(''), null)
})

test('fetch solo acepta contact:<uuid>; cualquier otra cosa se rechaza antes de tocar el SQL', () => {
  assert.ok(sqlFetch('contact:84a82220-c26b-40d4-a81f-3ff82387c644'))
  for (const malo of ["contact:x' or '1'='1", 'contact:', '84a82220-c26b-40d4-a81f-3ff82387c644', 'sale:1', '']) {
    assert.equal(sqlFetch(malo), null, malo)
  }
  assert.equal(esConsultaSoloLectura(sqlFetch('contact:84a82220-c26b-40d4-a81f-3ff82387c644').sql), true)
})

test('formato que ChatGPT espera: results con id/title/url y documento con id/title/text/url/metadata', () => {
  const r = resultadosDeBusqueda(
    [{ id: 'u1', full_name: 'Ana', email: 'a@x.test', instagram: null, tenant_slug: 'demo' }],
    'https://app.test'
  )
  assert.deepEqual(r, {
    results: [{ id: 'contact:u1', title: 'Ana · a@x.test', url: 'https://app.test/demo/crm/contactos/u1' }],
  })
  const d = documentoDeContacto(
    {
      id: 'u1',
      full_name: 'Ana',
      email: null,
      phone: null,
      instagram: '@ana',
      lifecycle: 'lead',
      notes: null,
      created_at: '2026-10-22T10:00:00Z',
      tenant_slug: 'demo',
      appointments: [{ id: 'a1', status: 'scheduled', result: null, created_at: '2026-10-22T11:00:00Z' }],
    },
    'https://app.test'
  )
  assert.deepEqual(Object.keys(d).sort(), ['id', 'metadata', 'text', 'title', 'url'])
  assert.match(d.text, /Citas \(1\)/)
})

test('el servidor negocia versión, anuncia solo lectura y devuelve errores de herramienta visibles', () => {
  assert.match(ruta, /PROTOCOL_VERSIONS = \['2025-06-18', '2025-03-26', '2024-11-05'\]/)
  assert.match(ruta, /readOnlyHint: true, destructiveHint: false/)
  for (const t of ['search', 'fetch', 'list_tenants', 'query_db', 'describe_table']) {
    assert.match(ruta, new RegExp(`name: '${t}'`), t)
  }
  assert.equal((ruta.match(/annotations: \{/g) ?? []).length, 7, 'cada herramienta lleva anotaciones')
  assert.match(ruta, /isError: true/)
  assert.doesNotMatch(ruta, /jsonRpcError\(id, -32000/, 'los fallos de herramienta ya no son errores de protocolo')
})
