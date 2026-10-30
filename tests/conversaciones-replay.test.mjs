import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  etiquetaEvento,
  indiceEnReplay,
  lineaReplay,
  offsetDePaso,
  programaReplay,
} from '../lib/conversaciones/replay.ts'

const T = (min) => new Date(Date.UTC(2026, 9, 21, 10, 0, 0) + min * 60_000).toISOString()

test('línea de replay: mensajes, eventos y notas ordenados por instante (sin hora utilizable no entra)', () => {
  const pasos = lineaReplay(
    [
      { direction: 'saliente', author: 'ia', body: ' diseño borrador', sent_at: T(11) },
      { direction: 'entrante', author: 'lead', body: 'Hola, precio?', sent_at: T(0) },
      { direction: 'saliente', author: 'humano', body: 'sin fecha válida', sent_at: 'no-es-fecha' },
    ],
    [
      { id: 'e1', kind: 'estado', data: { de: 'abierta', a: 'resuelta' }, created_at: T(20) },
      { id: 'e2', kind: 'resumen', data: null, created_at: 'no-es-fecha' },
    ],
    [{ id: 'n1', texto: 'seguir el lunes', creadoEn: T(25) }]
  )
  assert.equal(pasos.length, 4) // dos mensajes con hora + 1 evento + 1 nota (sin fecha no entra)
  assert.equal(pasos[0].tipo, 'mensaje')
  assert.equal(pasos[0].t, T(0))
  assert.equal(pasos[1].tipo, 'mensaje')
  assert.equal(pasos[1].author, 'ia')
  assert.equal(pasos[2].tipo, 'evento')
  assert.equal(pasos[3].tipo, 'nota')
  // Empate exacto de instante: el orden de entrada decide (testeable, no al azar).
  const empate = lineaReplay(
    [{ direction: 'entrante', author: 'lead', body: 'a', sent_at: T(0) }],
    [{ id: 'e', kind: 'estado', data: null, created_at: T(0) }],
    []
  )
  assert.equal(empate[0].tipo, 'mensaje')
  assert.equal(empate[1].tipo, 'evento')
})

test('programa + índice: el reloj es offset sobre el primer paso', () => {
  // Fixture en segundos: 0 s, 90 s y 180 s (3 pasos).
  const pasos = lineaReplay(
    [
      { direction: 'entrante', author: 'lead', body: 'Hola', sent_at: T(0) },
      { direction: 'saliente', author: 'humano', body: 'Hola!', sent_at: T(1.5) },
      { direction: 'saliente', author: 'ia', body: 'Cierro', sent_at: T(3) },
    ],
    [],
    []
  )
  const programa = programaReplay(pasos)
  assert.equal(programa.inicio, T(0))
  assert.equal(programa.duracionMs, 180_000)
  assert.equal(indiceEnReplay(programa.pasos, -1000), -1)
  assert.equal(indiceEnReplay(programa.pasos, 0), 0)
  assert.equal(indiceEnReplay(programa.pasos, 90_000), 1)
  assert.equal(indiceEnReplay(programa.pasos, 140_000), 1)
  assert.equal(indiceEnReplay(programa.pasos, 600_000), 2)
  // offset de cada paso y clamps
  assert.equal(offsetDePaso(programa.pasos, -1), 0)
  assert.equal(offsetDePaso(programa.pasos, 99), 180_000)
  assert.equal(offsetDePaso(programa.pasos, 2), 180_000)
  // línea vacía no muerde
  assert.equal(programaReplay([]).duracionMs, 0)
  assert.equal(indiceEnReplay([], 0), -1)
})

test('etiquetaEvento: textos en español por kind, ids de personas nunca a la vista', () => {
  // Cambios de estado (ruso de la base + estado de acciones).
  assert.equal(etiquetaEvento('estado', { de: 'abierta', a: 'resuelta' }), 'Estado: abierta → resuelta')
  assert.equal(etiquetaEvento('traspaso', { motivo: 'precio: pide precio y condiciones' }), 'Traspaso a humano: precio')
  assert.equal(etiquetaEvento('traspaso', null), 'Traspaso a humano')
  assert.equal(
    etiquetaEvento('asignacion', { de: null, a: 'uuid-qualquiera', auto: true }),
    'Asignación automática a un setter'
  )
  assert.equal(etiquetaEvento('asignacion', { de: null, a: 'uuid-qualquiera' }), 'Asignación a una persona')
  assert.equal(etiquetaEvento('etiquetas', { de: [], a: ['recio', 'no-contactar'] }), 'Etiquetas: recio, no-contactar')
  assert.equal(etiquetaEvento('etiquetas', { de: ['recio'], a: [] }), 'Etiquetas quitadas')
  assert.equal(etiquetaEvento('modo_ia', { de: 'off', a: 'autonomo' }), 'Modo de la IA: autónomo')
  assert.equal(etiquetaEvento('modo_ia', { de: 'borrador', a: 'off' }), 'Modo de la IA: apagado')
  assert.equal(etiquetaEvento('borrador', { estado: 'pendiente' }), 'Borrador del agente pendiente de revisar')
  assert.equal(etiquetaEvento('borrador', { estado: 'aprobado' }), 'Borrador aprobado y enviado')
  assert.equal(etiquetaEvento('ia_envio', null), 'Envío del agente de IA')
  assert.equal(etiquetaEvento('resumen', null), 'Resumen de memoria actualizado')
  assert.equal(etiquetaEvento('nota', { menciones: [] }), 'Nota privada del equipo')
  assert.equal(etiquetaEvento('nota_fijar', { fijar: true }), 'Nota privada fijada')
  assert.equal(etiquetaEvento('nota_fijar', { fijar: false }), 'Nota privada desfijada')
  // Un kind desconocido se muestra tal cual (no se inventa texto), con data a null incluido.
  assert.equal(etiquetaEvento('futuro', null), 'futuro')
})
