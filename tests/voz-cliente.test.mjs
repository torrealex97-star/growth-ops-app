import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { analizarVoz, anonimizar, ideasDeContenido, temasDeTexto } from '../lib/insights/voz-cliente.ts'
import { leerVozCliente, textosDeQualification, textosDeRespuesta } from '../lib/insights/voz-cliente-datos.ts'

const f = (persona, texto, grupo = 'potenciales', origen = 'formulario_previo') => ({ persona, grupo, origen, texto })

test('clasifica por temas y una respuesta basura no encaja en ninguno', () => {
  assert.deepEqual(temasDeTexto('No tengo tiempo y el precio es muy caro'), ['dinero', 'tiempo'])
  assert.ok(temasDeTexto('Me da miedo que sea una estafa').includes('confianza'))
  assert.deepEqual(temasDeTexto('ok'), [])
  assert.deepEqual(temasDeTexto('zzzz qqqq'), [])
})

test('anonimiza email, teléfono, enlaces y usuarios; descarta lo que no es una frase', () => {
  const a = anonimizar('Escríbeme a ana@correo.com o al +34 612 345 678, mi insta es @ana_vive y web https://x.es/yo')
  assert.doesNotMatch(a, /ana@correo|612|@ana_vive|https/)
  assert.match(a, /\[email\].*\[número\].*\[usuario\].*\[enlace\]/)
  assert.equal(anonimizar('sí'), null)
  assert.ok(anonimizar('palabra '.repeat(60)).length <= 162)
})

test('se cuentan PERSONAS, no menciones, y los porcentajes llevan la base', () => {
  const frag = [
    f('p1', 'No tengo dinero'),
    f('p1', 'el precio es alto'),
    f('p1', 'no me llega el dinero'),
    f('p2', 'No tengo tiempo'),
    f('p3', 'Sin dinero ahora'),
    f('p4', 'quiero algo distinto de verdad ahora'),
    f('p5', 'ya probé otras cosas y no funcionó'),
  ]
  const v = analizarVoz(frag).potenciales
  assert.equal(v.base, 5)
  const dinero = v.temas.find((t) => t.id === 'dinero')
  assert.equal(dinero.personas, 2, 'p1 cuenta una vez aunque lo diga tres veces')
  assert.equal(dinero.pct, 40)
  assert.equal(v.otros.personas, 1)
  assert.equal(v.otros.avisoClasificacion, false, 'con base < 10 no se avisa')
})

test('si más del 20 % no encaja en un tema, se avisa de que la clasificación se queda corta', () => {
  const frag = Array.from({ length: 10 }, (_, i) =>
    f(`p${i}`, i < 7 ? 'no tengo dinero' : 'algo completamente distinto aquí')
  )
  const v = analizarVoz(frag).potenciales
  assert.equal(v.otros.pct, 30)
  assert.equal(v.otros.avisoClasificacion, true)
})

test('citas: solo si se piden, de personas distintas y anonimizadas', () => {
  const frag = [
    f('p1', 'no tengo dinero, llámame al 612345678'),
    f('p1', 'dinero dinero dinero'),
    f('p2', 'el dinero no me llega'),
  ]
  assert.deepEqual(analizarVoz(frag).potenciales.temas[0].citas, [])
  const c = analizarVoz(frag, { conCitas: true }).potenciales.temas[0].citas
  assert.equal(c.length, 2)
  assert.ok(c.every((x) => !/612345678/.test(x)))
})

test('ideas: solo de temas con ≥3 personas y siempre con la cifra', () => {
  const frag = [
    ...['a', 'b', 'c', 'd'].map((p) => f(p, 'no tengo tiempo')),
    f('e', 'el precio'),
    f('g', 'estafa', 'clientes', 'feedback'),
  ]
  const ideas = ideasDeContenido(analizarVoz(frag))
  assert.ok(ideas.length >= 1)
  assert.ok(ideas.every((i) => /\d+ de \d+/.test(i.dato)))
  assert.ok(
    ideas.every((i) => i.tema !== 'Desconfianza: miedo a que sea humo o estafa'),
    'un solo cliente no es un patrón'
  )
  assert.deepEqual(ideasDeContenido(analizarVoz([])), [])
})

test('extracción de textos libres de qualification y de respuestas de formulario', () => {
  const t = textosDeQualification({
    respuestas: [
      { q: '¿Cuál es tu mayor miedo para empezar?', a: 'No sé si seré capaz de hacerlo' },
      { q: '¿Edad?', a: '35 años de edad aquí' },
      { q: '¿Por qué ahora?', a: 'corto' },
    ],
  })
  assert.deepEqual(t, ['No sé si seré capaz de hacerlo'])
  assert.deepEqual(textosDeQualification(null), [])
  assert.deepEqual(textosDeRespuesta({ a: 'una respuesta suficientemente larga', b: 5, c: 'corta' }), [
    'una respuesta suficientemente larga',
  ])
  assert.deepEqual(textosDeRespuesta(null), [])
})

function sb(tablas) {
  const consultas = []
  return {
    consultas,
    from(t) {
      const fl = {}
      const q = {
        select: () => q,
        eq: (k, v) => ((fl[k] = v), q),
        not: () => q,
        in: () => q,
        gte: () => q,
        order: () => q,
        limit: () => q,
        then: (res) => (consultas.push({ t, tenant: fl.tenant_id }), res({ data: tablas[t] ?? [], error: null })),
      }
      return q
    },
  }
}

test('lector: separa clientes de potenciales, ignora reservas abiertas y filtra por tenant', async () => {
  const cliente = sb({
    sales: [
      { contact_id: 'c1', reservation_completed_at: null, payment_plans: { method: 'tarjeta' } },
      { contact_id: 'c2', reservation_completed_at: null, payment_plans: { method: 'reserva' } },
    ],
    contacts: [
      { id: 'c1', qualification: { respuestas: [{ q: 'Mayor miedo', a: 'No tengo tiempo para esto' }] } },
      { id: 'c2', qualification: { respuestas: [{ q: 'Mayor miedo', a: 'No tengo tiempo para esto' }] } },
    ],
    appointments: [{ id: 'a1', contact_id: 'c1', objeciones: ['Es caro para mí ahora'] }],
    forms: [{ id: 'F1', audience: 'alumnos' }],
    form_responses: [{ id: 'r1', form_id: 'F1', contact_id: null, answers: { x: 'La clase me pareció muy práctica' } }],
  })
  const r = await leerVozCliente(cliente, 'T1', { dias: 90, conCitas: false })
  assert.equal(r.voz.clientes.base, 2, 'c1 (compró) y la respuesta de alumnos')
  assert.equal(r.voz.potenciales.base, 1, 'c2 solo reservó: sigue siendo potencial')
  assert.equal(r.voz.clientes.porOrigen.llamada_ventas, 1)
  assert.ok(cliente.consultas.every((c) => c.tenant === 'T1'))
  assert.ok(r.voz.clientes.temas.every((t) => t.citas.length === 0))
})

test('la ruta limita las citas literales a admin/director', () => {
  const api = readFileSync('app/api/[tenant]/evergreen/insights/voz-cliente/route.ts', 'utf8')
  assert.match(api, /\['admin', 'director'\]\.includes/)
  assert.match(api, /requireTenant/)
})
