import assert from 'node:assert/strict'
import test from 'node:test'

import {
  computeAdQuality,
  creativoDe,
  desgloseCalidad,
  edadAprox,
  isRealAd,
  publicoDe,
  qualityScore,
  qualityScoreJunio,
  resolveFields,
  temasDe,
  tieneIndependencia,
  tramoDinero,
  v2Ambicion,
  v2Edad,
  v2Independencia,
} from '../lib/launch/calidad.ts'
import { normalizarEntrega, phoneSuffix } from '../lib/launch/webhook.ts'
import { diaSiguiente, inicioDiaMadrid, launchLabel } from '../lib/launch/lanzamientos.ts'

// L1 LANZAMIENTOS — núcleo puro. El scoring de lead se resolvió por texto de pregunta a propósito
// (ver lib/launch/calidad.ts): estos tests clavan los patrones para que una reformulación en GHL
// rompa un test y no el panel. Los helpers de fecha fijan el desfase de España (verano/invierno):
// la apertura de un lanzamiento mueve apuntados por un CORTE en hora local, no en UTC.

// ── Resolución de respuestas por texto ────────────────────────────────────────

const encuesta = {
  respuestas: [
    { q: '¿Tienes independencia económica?', a: 'Sí, tengo independencia' },
    { q: '¿Cuánto ganas actualmente?', a: '1.000 € y 2.000 € al mes' },
    { q: '¿Cuánto quieres ganar al mes?', a: 'Más de 5.000' },
    { q: '¿Cuál es tu edad?', a: '25-34' },
    { q: '¿Qué es lo que te frena?', a: 'No tengo tiempo' },
    { q: '¿Qué tendría que pasar al final del evento para que haya merecido la pena?', a: 'Un paso a paso claro' },
  ],
}

test('resolveFields: objetivo se resuelve ANTES que salario (ambos contienen "ganar")', () => {
  const f = resolveFields(encuesta)
  assert.equal(f.objetivo, 'Más de 5.000')
  assert.equal(f.salario, '1.000 € y 2.000 € al mes')
  assert.equal(f.independencia, 'Sí, tengo independencia')
  assert.equal(f.edad, '25-34')
  assert.equal(f.frenos, 'No tengo tiempo')
  assert.equal(f.que_piden, 'Un paso a paso claro')
})

test('resolveFields: cada pregunta solo se usa una vez', () => {
  const f = resolveFields({
    respuestas: [
      { q: '¿Cuánto quieres ganar al mes?', a: '3.000 €' },
      { q: '¿Cuánto ganas actualmente?', a: '1.500 €' },
    ],
  })
  assert.equal(f.objetivo, '3.000 €')
  assert.equal(f.salario, '1.500 €')
})

test('resolveFields: respaldo con claves mapeadas cuando el texto no casa', () => {
  const f = resolveFields({ ingresos: '2.000 €', situacion: 'autónomo', edad: '35-44' })
  assert.equal(f.salario, '2.000 €')
  assert.equal(f.ocupacion, 'autónomo')
  assert.equal(f.edad, '35-44')
})

// ── Scoring v2 ───────────────────────────────────────────────────────────────

test('la negación nunca puntúa como un sí (contiene "tengo independencia")', () => {
  assert.equal(tieneIndependencia('No, todavía no tengo independencia'), false)
  assert.equal(tieneIndependencia('Sí, tengo independencia'), true)
  assert.equal(v2Independencia('No, todavía no tengo independencia'), 0)
  assert.equal(v2Independencia('Depende de mi pareja'), 1)
  assert.equal(v2Independencia('Sí'), 3)
})

test('tramoDinero: reconoce los formatos que llegan (€, "1k", separadores)', () => {
  assert.equal(tramoDinero('menos de 1.000'), 0)
  assert.equal(tramoDinero('€1k y €2k'), 1)
  // El original solo reconoce rangos de miles cerrados (X.000 a Y.000); un extremo suelto es null.
  assert.equal(tramoDinero('2.000 a 3.000'), 2)
  assert.equal(tramoDinero('2.000 a 3.500'), null)
  assert.equal(tramoDinero('Más de 5.000'), 3)
  assert.equal(tramoDinero('más de 10.000'), 4)
  assert.equal(tramoDinero('no sé'), null)
})

test('ambición: el gap entre lo que gana y lo que quiere ganar', () => {
  assert.equal(v2Ambicion('€1k y €2k', '2.000 a 3.000'), 1) // gap 1
  assert.equal(v2Ambicion('€1k y €2k', 'más de 5.000'), 2) // gap 3
  assert.equal(v2Ambicion('2.000 a 3.000', '€1k y €2k'), 0) // quiere menos: gap negativo
  assert.equal(v2Ambicion('no sé', 'más de 5.000'), 0) // falta un lado: no se inventa
})

test('edad: punto medio del rango y tramos abiertos', () => {
  assert.equal(edadAprox('25-34'), 30)
  assert.equal(edadAprox('Menos de 25'), 22)
  assert.equal(edadAprox('Más de 50'), 55)
  assert.equal(edadAprox('no lo digo'), null)
  assert.equal(v2Edad('25-34'), 2)
  assert.equal(v2Edad('Más de 55'), 1.5)
  assert.equal(v2Edad('18-24'), 0.5)
})

test('calidad 0-10 con el criterio v2 y null si no hay nada que puntúe', () => {
  const f = resolveFields(encuesta)
  // independencia 3 + ingresos 2 + ambición 2 + edad 2 + relacionIA (no contestó) 0 = 9
  assert.equal(qualityScore(f), 9)
  assert.deepEqual(desgloseCalidad(f), { independencia: 3, ingresos: 2, ambicion: 2, edad: 2, relacionIA: 0 })
  assert.equal(qualityScore({}), null)
})

test('calidad de junio se conserva tal cual para la comparativa', () => {
  const f = resolveFields(encuesta)
  // independencia 4 + salario (tramo 1 → 1) + objetivo (tramo 3 → 2) = 7/13 → 5.4
  assert.equal(qualityScoreJunio(f), 5.4)
})

// ── Temas de la pregunta abierta ─────────────────────────────────────────────

test('temasDe: determinista y con basura → no_sabe', () => {
  assert.deepEqual(temasDe('Que sea real, no un vendehumos'), ['confianza'])
  assert.deepEqual(temasDe('No tengo dinero para invertir'), ['dinero'])
  assert.deepEqual(temasDe('Un paso a paso y aprender a crear agentes'), ['paso_a_paso', 'crear_agentes'])
  assert.deepEqual(temasDe('.'), ['no_sabe'])
  assert.deepEqual(temasDe(''), ['no_sabe'])
  assert.deepEqual(temasDe('cualquier cosa rara'), ['otros'])
})

// ── Agrupación de creativos y públicos ───────────────────────────────────────

test('creativoDe: el mismo creativo con prefijo de conjunto y "- Copia" agrupa igual', () => {
  const a = creativoDe('ADV | AD 7 SEP - Copia')
  const b = creativoDe('AD 7 SEP')
  assert.equal(a.key, b.key)
  assert.equal(b.label, 'AD 7 SEP')
  assert.equal(creativoDe('1234567890123').label, 'ID Meta …67890123')
})

test('publicoDe: retargeting y advantage por el prefijo, lookalike por la campaña', () => {
  assert.equal(publicoDe('RT | AD 3', null), 'Retargeting')
  assert.equal(publicoDe('ADV | AD 3', null), 'Advantage+')
  assert.equal(publicoDe(null, 'Lookalike España 1%'), 'Lookalike')
  assert.equal(publicoDe(null, null), 'Sin campaña')
})

test('isRealAd: los valores de ruido de plataforma no son anuncios', () => {
  assert.equal(isRealAd('paid'), false)
  assert.equal(isRealAd('bio-instagram'), false)
  assert.equal(isRealAd('AD 7 SEP'), true)
  assert.equal(isRealAd(null), false)
})

test('computeAdQuality: agrupa, exige volumen mínimo y ordena por scoreComposite', () => {
  const lead = (id, anuncio, q) => ({
    id,
    anuncio,
    campana: null,
    fields: q === null ? {} : { independencia: 'Sí', salario: '1.000 €', objetivo: '3.000 €', edad: '25-34' },
    quality: q,
    qualityJunio: q,
    citas: 0,
    ventas: 0,
    confirmado: false,
  })
  const anuncios = computeAdQuality([
    ...Array.from({ length: 5 }, (_, i) => lead(`g${i}`, 'AD GANADOR', 9)),
    ...Array.from({ length: 3 }, (_, i) => lead(`m${i}`, 'AD MEDIO', 5)),
    lead('s1', 'AD CORTO', 10), // 2 leads: debajo del mínimo, no entra
    lead('s2', 'AD CORTO', null),
    lead('ruido', 'paid', 9),
  ])
  assert.equal(anuncios.length, 2)
  assert.equal(anuncios[0].anuncio, 'AD GANADOR')
  assert.equal(anuncios[0].totalLeads, 5)
  assert.equal(anuncios[0].avgQuality, 9)
  assert.equal(anuncios[1].anuncio, 'AD MEDIO')
  assert.ok(anuncios[0].scoreComposite >= anuncios[1].scoreComposite)
})

// ── Webhook: normalización pura ──────────────────────────────────────────────

test('phoneSuffix: últimos 9 dígitos; algo demasiado corto no arriesga un match', () => {
  assert.equal(phoneSuffix('+34 635 64 16 54'), '635641654')
  assert.equal(phoneSuffix('0034-675-568-345'), '675568345')
  assert.equal(phoneSuffix('635 64'), null)
  assert.equal(phoneSuffix(null), null)
})

test('normalizarEntrega: el evento lo decide la URL; sin él, alta por defecto', () => {
  const alta = normalizarEntrega({ contact_id: 'ghl-1', email: 'A@EXAMPLE.com', phone: '+34635641654' }, null)
  assert.equal(alta.evento, 'alta')
  assert.equal(alta.email, 'a@example.com')
  assert.equal(alta.ghlContactId, 'ghl-1')

  const confirm = normalizarEntrega({ email: 'a@example.com' }, 'confirmacion')
  assert.equal(confirm.evento, 'confirmacion')

  // Un evento desconocido en la URL no se adivina por el cuerpo.
  assert.equal(normalizarEntrega({ email: 'a@example.com' }, 'cosas'), null)

  // El payload puede decirlo también (payload.evento), pero solo con un evento conocido.
  assert.equal(normalizarEntrega({ evento: 'confirmacion', email: 'a@example.com' }, null).evento, 'confirmacion')
  assert.equal(normalizarEntrega({ evento: 'otro', email: 'a@example.com' }, null).evento, 'alta')
})

test('normalizarEntrega: respuestas desde customData y UTMs de la raíz o del contacto', () => {
  const e = normalizarEntrega(
    {
      contact: { email: 'a@example.com', utm_source: 'meta', utm_content: 'AD 7 SEP' },
      customData: { '¿Tienes independencia económica?': 'Sí' },
      utm_campaign: 'lanzamiento-oct',
    },
    null
  )
  assert.deepEqual(e.respuestas, [{ q: '¿Tienes independencia económica?', a: 'Sí' }])
  assert.equal(e.utms.utm_source, 'meta')
  assert.equal(e.utms.utm_content, 'AD 7 SEP')
  assert.equal(e.utms.utm_campaign, 'lanzamiento-oct')
  // Con respuestas el evento por defecto es encuesta (no crea contacto).
  assert.equal(e.evento, 'encuesta')
})

test('normalizarEntrega: customData en lista de {question, answer} también vale', () => {
  const e = normalizarEntrega(
    { email: 'a@example.com', customData: [{ question: '¿Edad?', answer: '25-34' }] },
    'encuesta'
  )
  assert.deepEqual(e.respuestas, [{ q: '¿Edad?', a: '25-34' }])
})

// ── Fechas del calendario ────────────────────────────────────────────────────

test('inicioDiaMadrid: el desfase de España cambia con el horario de verano', () => {
  assert.match(inicioDiaMadrid('2026-07-01'), /T00:00:00\+02:00$/)
  assert.match(inicioDiaMadrid('2026-12-01'), /T00:00:00\+01:00$/)
})

test('diaSiguiente no salta de mes con los helpers UTC', () => {
  assert.equal(diaSiguiente('2026-09-30'), '2026-10-01')
  assert.equal(diaSiguiente('2026-02-28'), '2026-03-01')
})

test('launchLabel: nombre legible de un slug', () => {
  assert.equal(launchLabel('lanzamiento-28-oct'), 'Lanzamiento 28 Oct')
  assert.equal(launchLabel(null), '—')
})
