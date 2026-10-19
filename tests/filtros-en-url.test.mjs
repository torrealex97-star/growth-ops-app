import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { urlConParametro, valorDeUrl } from '../lib/hooks/useParamUrl.ts'

const base = 'https://app.example.test/demo/crm/agendas'

test('fijar un filtro lo escribe en la URL y el valor por defecto lo quita (URL limpia)', () => {
  const con = urlConParametro(base, 'estado', 'no_show', 'all')
  assert.equal(con, `${base}?estado=no_show`)
  assert.equal(urlConParametro(con, 'estado', 'all', 'all'), base)
  assert.equal(urlConParametro(con, 'estado', '', 'all'), base)
})

test('los demás parámetros de la URL se conservan', () => {
  const u = urlConParametro(`${base}?vista=tabla&otro=1`, 'closer', 'abc', 'all')
  assert.match(u, /vista=tabla/)
  assert.match(u, /otro=1/)
  assert.match(u, /closer=abc/)
})

test('un valor de la URL fuera de los permitidos se ignora (un enlace manipulado no rompe la pantalla)', () => {
  const permitidos = ['tabla', 'calendario']
  assert.equal(valorDeUrl('?vista=tabla', 'vista', permitidos), 'tabla')
  assert.equal(valorDeUrl('?vista=hackeado', 'vista', permitidos), null)
  assert.equal(valorDeUrl('', 'vista', permitidos), null)
  assert.equal(valorDeUrl('?estado=show', 'estado'), 'show')
})

test('Agendas y Registro de ventas guardan sus filtros en la URL, pero NO la búsqueda de texto (datos personales)', () => {
  for (const f of ['app/[tenant]/crm/agendas/page.tsx', 'app/[tenant]/ventas/registro/page.tsx']) {
    const src = readFileSync(f, 'utf8')
    assert.match(src, /useParamUrl<string>\('estado', 'all'\)/, f)
    assert.match(src, /useParamUrl<string>\('closer', 'all'\)/, f)
    assert.ok(!/useParamUrl<string>\('q'/.test(src), `${f}: el texto buscado (nombres, emails) no va a la URL`)
  }
})
