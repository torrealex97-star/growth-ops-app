import assert from 'node:assert/strict'
import test from 'node:test'
import { analizarVozCliente, anonimizar, temasDe } from '../lib/insights/voz-cliente.ts'

// EL CONTRATO. La voz del cliente (objeciones en llamadas, formularios de aplicación, feedback) se agrupa
// por temas con reglas deterministas; un tema exige repetición; lo no clasificado se cuenta; las citas
// salen sin datos personales.

const s = (origen, texto, fecha = '2026-10-01') => ({ origen, texto, fecha })

test('clasifica por tema, con tildes y sin ellas, y una señal puede sumar a varios temas', () => {
  assert.deepEqual(temasDe('Me parece muy caro'), ['precio'])
  assert.deepEqual(temasDe('No tengo tiempo, trabajo y tengo hijos'), ['tiempo'])
  assert.ok(temasDe('Es caro y además no tengo tiempo').includes('precio'))
  assert.ok(temasDe('Es caro y además no tengo tiempo').includes('tiempo'))
  assert.deepEqual(temasDe('Quiero consultarlo con mi pareja'), ['decision'])
  assert.deepEqual(temasDe('Ya compré otro curso y me decepcionó'), ['probado'])
  assert.deepEqual(temasDe('xyz abc'), [])
})

test('un tema exige repetición: una sola mención no es un patrón', () => {
  const r = analizarVozCliente([s('llamada', 'Es muy caro para mí'), s('formulario', 'No tengo tiempo para estudiar')])
  assert.equal(r.temas.length, 0, 'cada tema aparece una sola vez')
  assert.equal(r.clasificadas, 2)
  const r2 = analizarVozCliente([s('llamada', 'Es muy caro para mí'), s('formulario', 'El precio me frena mucho')])
  assert.equal(r2.temas.length, 1)
  assert.equal(r2.temas[0].id, 'precio')
  assert.equal(r2.temas[0].menciones, 2)
  assert.deepEqual(r2.temas[0].porOrigen, { llamada: 1, formulario: 1, feedback: 0 })
})

test('ordena por menciones, calcula el % sobre lo clasificado y cuenta lo que no encaja', () => {
  const r = analizarVozCliente([
    s('llamada', 'Me parece caro'),
    s('llamada', 'El precio es alto'),
    s('formulario', 'No puedo pagar ahora'),
    s('feedback', 'No tengo tiempo'),
    s('feedback', 'Poco tiempo con los niños'),
    s('formulario', 'Escribo esto sin ninguna palabra clave relevante'),
  ])
  assert.equal(r.total, 6)
  assert.equal(r.clasificadas, 5)
  assert.equal(r.sinClasificar, 1)
  assert.deepEqual(
    r.temas.map((t) => t.id),
    ['precio', 'tiempo']
  )
  assert.equal(r.temas[0].porcentaje, 60)
  assert.equal(r.temas[1].porcentaje, 40)
  assert.ok(r.temas[0].ideas.length >= 2 && r.temas[0].ideas.every((i) => i.gancho && i.angulo && i.formato))
})

test('sin datos no hay temas ni porcentajes inventados; los textos muy cortos se ignoran', () => {
  const r = analizarVozCliente([])
  assert.deepEqual(r, { total: 0, clasificadas: 0, sinClasificar: 0, temas: [] })
  assert.equal(analizarVozCliente([s('llamada', 'ok')]).total, 0)
})

test('las citas salen anonimizadas, recortadas, sin repetir y las más recientes primero', () => {
  assert.equal(
    anonimizar('Escríbeme a ana@ejemplo.com o al +34 600 123 456 o @ana_ig https://x.co/a'),
    'Escríbeme a [email] o al [teléfono] o [usuario] [enlace]'
  )
  const larga = `Es caro ${'palabra '.repeat(40)}`
  const r = analizarVozCliente([
    s('llamada', 'Es caro, escríbeme a ana@ejemplo.com', '2026-09-01'),
    s('llamada', 'Es caro, escríbeme a ana@ejemplo.com', '2026-09-02'),
    s('formulario', larga, '2026-10-05'),
  ])
  const citas = r.temas[0].citas
  assert.ok(citas[0].length <= 141 && citas[0].endsWith('…'), 'la más reciente primero y recortada')
  assert.equal(citas.filter((c) => c.includes('[email]')).length, 1, 'sin repetir')
  assert.ok(!citas.some((c) => c.includes('@ejemplo')))
})

import { textosDeRespuesta } from '../lib/insights/cargar-voz-cliente.ts'
test('de un formulario solo salen textos libres largos y opciones de «frenos»; nunca datos de contacto ni preguntas sin relación', () => {
  const preguntas = [
    { id: 'n', type: 'shortText', title: 'Nombre', semantic: 'contact.name' },
    { id: 'm', type: 'email', title: 'Email', semantic: 'contact.email' },
    { id: 'p', type: 'longText', title: '¿Qué te frena?' },
    { id: 'c', type: 'shortText', title: 'Ciudad' },
    {
      id: 'o',
      type: 'singleChoice',
      title: '¿Cuál es tu mayor obstáculo?',
      options: [{ value: 'a', label: 'No tengo tiempo suficiente' }],
    },
    {
      id: 'x',
      type: 'singleChoice',
      title: '¿Cómo nos conociste?',
      options: [{ value: 'ig', label: 'Instagram y anuncios' }],
    },
  ]
  const textos = textosDeRespuesta(preguntas, {
    n: 'Ana García Pérez',
    m: 'ana@ejemplo.com',
    p: 'Me frena no saber si me va a funcionar de verdad',
    c: 'Madrid',
    o: 'a',
    x: 'ig',
  })
  assert.deepEqual(textos, ['Me frena no saber si me va a funcionar de verdad', 'No tengo tiempo suficiente'])
})
