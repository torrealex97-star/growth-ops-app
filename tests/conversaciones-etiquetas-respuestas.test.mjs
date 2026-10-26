import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  aGuardableRespuestas,
  leerRespuestasRapidas,
  rellenarRespuesta,
  MAX_RESPUESTAS,
} from '../lib/conversaciones/respuestas-rapidas.ts'

test('la lectura de respuestas rápidas nunca confía en lo guardado', () => {
  assert.deepEqual(leerRespuestasRapidas(null), [])
  assert.deepEqual(leerRespuestasRapidas('no es json'), [])
  assert.deepEqual(leerRespuestasRapidas({ no: 'lista' }), [])
  const r = leerRespuestasRapidas([
    { titulo: '  Saludo  ', texto: 'Hola {{nombre}}' },
    { titulo: 'Saludo', texto: 'Otra' }, // título repetido → id distinto
    { titulo: '', texto: 'sin título' },
    { titulo: 'Sin texto', texto: '   ' },
    'basura',
    null,
  ])
  assert.deepEqual(
    r.map((x) => x.id),
    ['saludo', 'saludo-2']
  )
  assert.equal(r[0].titulo, 'Saludo')
})

test('límites: máximo de respuestas, título y texto acotados', () => {
  const muchas = Array.from({ length: 80 }, (_, i) => ({ titulo: `T${i}`, texto: 'x'.repeat(5000) }))
  const r = leerRespuestasRapidas(muchas)
  assert.equal(r.length, MAX_RESPUESTAS)
  assert.ok(r.every((x) => x.texto.length <= 1000 && x.titulo.length <= 40))
  assert.ok(JSON.parse(aGuardableRespuestas(muchas)).length === MAX_RESPUESTAS)
})

test('{{nombre}} se sustituye por el nombre de pila y no deja huecos raros', () => {
  assert.equal(rellenarRespuesta('Hola {{nombre}}, gracias', 'María José Pérez'), 'Hola María, gracias')
  assert.equal(rellenarRespuesta('Hola {{ NOMBRE }}!', null), 'Hola!')
  assert.equal(rellenarRespuesta('Sin variable', 'Ana'), 'Sin variable')
})

test('la API: lectura para el equipo de gestión, edición solo administración/marketing, con auditoría', () => {
  const r = readFileSync('app/api/[tenant]/evergreen/conversaciones/respuestas-rapidas/route.ts', 'utf8')
  assert.match(r, /ROLES_GESTION as readonly string\[\]/)
  assert.match(r, /ROLES_EDITAR_RESPUESTAS as readonly string\[\]/)
  assert.match(r, /aGuardableRespuestas\(/)
  assert.match(r, /from\('audit_logs'\)\.insert/)
  assert.match(r, /\.eq\('tenant_id', sesion\.tenantId\)/)
})

test('la bandeja ofrece etiquetas y respuestas rápidas sin enviar nada solo', () => {
  const p = readFileSync('app/[tenant]/conversaciones/BandejaTab.tsx', 'utf8')
  assert.match(p, /accion: 'etiquetas'/)
  assert.match(p, /aria-label="Respuestas rápidas"/)
  assert.match(p, /setRespuesta\(rellenarRespuesta\(/)
  // Elegir una respuesta rápida solo rellena el cuadro: el envío sigue exigiendo pulsar «Enviar».
  assert.doesNotMatch(p, /onChange=\{[^}]*enviarRespuesta/)
})
