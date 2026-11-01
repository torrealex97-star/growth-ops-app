import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  FACTOR_APAGAR,
  FACTOR_ESCALAR,
  construirAcciones,
  construirEmbudo,
  datosQueFaltan,
  distribucion,
  frasesRepetidas,
  veredictoAnuncio,
} from '../lib/launch/informe.ts'
import { leerInforme } from '../lib/launch/informe-datos.ts'

test('embudo: un dato que falta es null (no 0) y no rompe el porcentaje de los demás pasos', () => {
  const e = construirEmbudo({
    registrados: 200,
    confirmados: 100,
    invitados: 40,
    agendados: null,
    asistieron: null,
    ventas: 5,
  })
  const por = Object.fromEntries(e.map((p) => [p.id, p]))
  assert.equal(por.confirmados.pctSobreAnterior, 50)
  assert.equal(por.agendados.n, null)
  assert.equal(por.agendados.pctSobreAnterior, null)
  assert.equal(por.ventas.pctSobreRegistrados, 2.5)
  assert.equal(por.ventas.pctSobreAnterior, 5, 'ventas se compara con el último paso CON dato (confirmados 100)')
  assert.equal(
    construirEmbudo({ registrados: 0, confirmados: 0, invitados: 0, agendados: 0, asistieron: 0, ventas: 0 })[1]
      .pctSobreAnterior,
    null
  )
})

test('veredicto: muestra corta o sin referencia no decide; escalar/apagar exigen calidad Y proporción de buenos', () => {
  const ad = (o) => ({ muestraCorta: false, avgQuality: 5, pctBuenos: 40, ...o })
  const ref = { avgQuality: 5, pctBuenos: 30 }
  assert.equal(veredictoAnuncio(ad({ muestraCorta: true }), ref), 'muestra_corta')
  assert.equal(veredictoAnuncio(ad({}), { avgQuality: null, pctBuenos: null }), 'muestra_corta')
  assert.equal(veredictoAnuncio(ad({ avgQuality: 5 * FACTOR_ESCALAR, pctBuenos: 35 }), ref), 'escalar')
  assert.equal(
    veredictoAnuncio(ad({ avgQuality: 5 * FACTOR_ESCALAR, pctBuenos: 10 }), ref),
    'mantener',
    'mucha media pero menos buenos: no se escala'
  )
  assert.equal(veredictoAnuncio(ad({ avgQuality: 5 * FACTOR_APAGAR, pctBuenos: 10 }), ref), 'apagar')
  assert.equal(veredictoAnuncio(ad({ avgQuality: 5 * FACTOR_APAGAR, pctBuenos: 50 }), ref), 'mantener')
})

test('distribución: agrupa respuestas iguales sin importar mayúsculas ni tildes y da n y porcentaje', () => {
  const d = distribucion(['No tengo tiempo', 'no tengo tiempo', 'Dinero', '', null, 'DINERO ', 'miedo'])
  assert.equal(d.base, 5)
  assert.deepEqual(
    d.items.map((i) => [i.n, i.pct]),
    [
      [2, 40],
      [2, 40],
      [1, 20],
    ]
  )
})

test('frases: cuenta personas (no repeticiones), exige mínimo y se queda con la más larga', () => {
  const t = [
    'quiero ganar dinero online para mi familia',
    'ganar dinero online sin jefe',
    'busco ganar dinero online',
    'ganar dinero online ganar dinero online ganar dinero online',
    'otra cosa distinta',
  ]
  const f = frasesRepetidas(t)
  assert.equal(f.base, 5)
  assert.ok(
    f.items.some((x) => x.frase === 'ganar dinero online' && x.personas === 4),
    'una persona que repite no pesa más'
  )
  assert.ok(!f.items.some((x) => x.frase === 'ganar dinero'), 'la corta contenida se descarta')
  assert.equal(frasesRepetidas(['una frase sola', 'otra frase'], 3).items.length, 0)
})

test('datos que faltan: cada fuente ausente se nombra con su solución; todo conectado no devuelve nada', () => {
  const todo = {
    agendas: true,
    ventas: true,
    meta: true,
    tiktokAds: true,
    googleAds: true,
    nutricionEmail: true,
    nutricionWhatsapp: true,
    asistenciaEvento: true,
    creativoOrigen: true,
    encuesta: true,
  }
  assert.deepEqual(datosQueFaltan(todo), [])
  const f = datosQueFaltan({ ...todo, meta: false, asistenciaEvento: false })
  assert.deepEqual(
    f.map((x) => x.id),
    ['meta', 'asistencia_evento']
  )
  assert.ok(f.every((x) => x.mensaje && x.solucion))
})

test('acciones: solo con cifra que las justifique', () => {
  const embudo = construirEmbudo({
    registrados: 100,
    confirmados: 30,
    invitados: 0,
    agendados: null,
    asistieron: null,
    ventas: null,
  })
  const a = construirAcciones({
    anuncios: [
      { anuncio: 'A', veredicto: 'escalar', totalLeads: 40, pctBuenos: 50 },
      { anuncio: 'B', veredicto: 'mantener', totalLeads: 30, pctBuenos: 30 },
    ],
    embudo,
    frenos: { base: 50, items: [{ texto: 'No tengo tiempo', n: 20, pct: 40 }] },
    faltan: [],
  })
  assert.equal(a.filter((x) => x.area === 'anuncios').length, 1)
  assert.ok(a.every((x) => x.dato.length > 0))
  assert.ok(a.some((x) => x.area === 'embudo' && /30%/.test(x.dato)))
  assert.ok(a.some((x) => x.area === 'audiencia' && /20 de 50/.test(x.dato)))
  const sinBase = construirAcciones({
    anuncios: [],
    embudo: construirEmbudo({
      registrados: 10,
      confirmados: 9,
      invitados: 0,
      agendados: null,
      asistieron: null,
      ventas: null,
    }),
    frenos: { base: 5, items: [{ texto: 'x', n: 5, pct: 100 }] },
    faltan: [],
  })
  assert.equal(sinBase.length, 0, 'con base pequeña no se recomienda')
})

// ── Cruce con agendas y ventas (cliente simulado)
function sb({ lanz = { id: 'L', label: 'Lanz', fecha: '2026-10-28' }, leads, citas, ventas }) {
  const consultas = []
  return {
    consultas,
    from(tabla) {
      const f = {}
      let head = false
      const q = {
        select: (_c, o) => ((head = Boolean(o?.head)), q),
        eq: (k, v) => ((f[k] = v), q),
        in: (k, v) => ((f[k + '_in'] = v), q),
        gte: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: f.tenant_id === 'T1' ? lanz : null }),
        then: (res) => {
          consultas.push({ tabla, tenant: f.tenant_id })
          if (tabla === 'contact_launches')
            return res(head ? { count: leads.length, error: null } : { data: leads, error: null })
          if (tabla === 'appointments') return res({ data: citas, error: null })
          if (tabla === 'sales') return res({ data: ventas, error: null })
          return res({ data: [], error: null })
        },
      }
      return q
    },
  }
}

test('informe: cuenta personas, no cita cancelada, y una reserva abierta NO es venta (MONEY D8)', async () => {
  const q = { respuestas: [{ q: '¿Qué te frena?', a: 'No tengo tiempo' }] }
  const leads = [1, 2, 3, 4].map((i) => ({
    id: `cl${i}`,
    created_at: '2026-10-20T10:00:00Z',
    confirmed_at: i <= 2 ? '2026-10-27T10:00:00Z' : null,
    invitado_at: null,
    utm: { utm_content: 'anuncio-1' },
    contact_id: `c${i}`,
    contacts: { qualification: q },
  }))
  const cliente = sb({
    leads,
    citas: [
      { contact_id: 'c1', status: 'show' },
      { contact_id: 'c1', status: 'cancelled' },
      { contact_id: 'c2', status: 'cancelled' },
      { contact_id: 'c3', status: 'scheduled' },
    ],
    ventas: [
      { contact_id: 'c1', reservation_completed_at: null, payment_plans: { method: 'tarjeta' } },
      { contact_id: 'c3', reservation_completed_at: null, payment_plans: { method: 'reserva' } },
    ],
  })
  const r = await leerInforme(cliente, 'T1', 'L', {})
  const por = Object.fromEntries(r.embudo.map((p) => [p.id, p.n]))
  assert.equal(por.registrados, 4)
  assert.equal(por.confirmados, 2)
  assert.equal(por.agendados, 2, 'c1 y c3; c2 solo tenía una cita cancelada')
  assert.equal(por.asistieron, 1)
  assert.equal(por.ventas, 1, 'la reserva abierta de c3 no cuenta')
  assert.ok(
    cliente.consultas.every((c) => c.tenant === 'T1'),
    'toda consulta lleva el tenant'
  )
  assert.ok(r.faltan.some((f) => f.id === 'asistencia_evento'))
  assert.ok(!r.faltan.some((f) => f.id === 'creativo'))
  await assert.rejects(leerInforme(cliente, 'T2', 'L', {}), /no encontrado/)
})

test('la ruta del informe exige sesión de la subcuenta y devuelve solo agregados', () => {
  const api = readFileSync('app/api/[tenant]/evergreen/lanzamiento/informe/route.ts', 'utf8')
  assert.match(api, /requireTenant/)
  const datos = readFileSync('lib/launch/informe-datos.ts', 'utf8')
  assert.doesNotMatch(datos, /full_name|email|phone/, 'sin datos personales en el informe')
  assert.match(datos, /esReservaAbierta/)
})
