import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  instanteDeVenta,
  mesDeLiquidacion,
  resumenDinero,
  sincronizarComisionesColdCalling,
  sincronizarTrasVenta,
  ventasQueCuentan,
} from '../lib/cold-calling/comisiones.ts'
import { importeDeVenta, leerAjustes, validarTramos } from '../lib/cold-calling/config.ts'
import { ESTADO_IDS, ESTADOS_LLAMADA } from '../lib/cold-calling/estados.ts'
import { actualizarLead, reasignarLead } from '../lib/cold-calling/operaciones.ts'
import { esCaller, puedeConfigurarColdCalling, puedeGestionarColdCalling } from '../lib/cold-calling/policy.ts'
import { ordenarBolsa, pedirMas, sinRepetidos, tel9 } from '../lib/cold-calling/reparto.ts'
import { sbMemoria } from './fixtures/sb-memoria.mjs'

const T = 'tenant-a'
const TRAMOS = [
  { desde: 1, hasta: 2, importe: 50 },
  { desde: 3, hasta: null, importe: 80 },
]

// ── Ajustes ─────────────────────────────────────────────────────────────────

test('tramos: cubren todas las ventas sin huecos ni solapes, y el último no tiene tope', () => {
  assert.deepEqual(validarTramos(TRAMOS), TRAMOS)
  assert.deepEqual(validarTramos([]), [], 'sin tramos es válido: no hay comisión por venta')
  assert.throws(() => validarTramos([{ desde: 2, hasta: null, importe: 10 }]), /empezar en la venta 1/)
  assert.throws(
    () =>
      validarTramos([
        { desde: 1, hasta: 3, importe: 10 },
        { desde: 5, hasta: null, importe: 20 },
      ]),
    /empezar en la venta 4/
  )
  assert.throws(() => validarTramos([{ desde: 1, hasta: 3, importe: 10 }]), /último tramo no lleva tope/)
  assert.throws(() => validarTramos([{ desde: 1, hasta: null, importe: -1 }]), /importe no es válido/)
  assert.throws(() => validarTramos([{ desde: 1, hasta: null, importe: 10.123 }]), /dos decimales/)
  assert.throws(() => validarTramos([{ desde: 1, hasta: null, importe: '10' }]), /importe no es válido/)
  assert.throws(() => validarTramos('x'), /lista/)
})

test('importe por número de venta; sin tramos NO se inventa un importe', () => {
  assert.equal(importeDeVenta(TRAMOS, 1), 50)
  assert.equal(importeDeVenta(TRAMOS, 2), 50)
  assert.equal(importeDeVenta(TRAMOS, 3), 80)
  assert.equal(importeDeVenta(TRAMOS, 40), 80)
  assert.equal(importeDeVenta([], 1), null)
})

test('una subcuenta sin ajustes guardados no tiene tramos; cada subcuenta lee los suyos', async () => {
  const { sb } = sbMemoria({
    cold_calling_settings: [
      { tenant_id: 'otra', tramos: TRAMOS, tanda: 5, pedir_mas_si_quedan: 1, objetivo_confirmados: 9 },
    ],
  })
  const a = await leerAjustes(sb, T)
  assert.equal(a.guardado, false)
  assert.deepEqual(a.tramos, [])
  const b = await leerAjustes(sb, 'otra')
  assert.equal(b.tanda, 5)
  assert.deepEqual(b.tramos, TRAMOS)
})

// ── Comisión ────────────────────────────────────────────────────────────────

const asig = (o = {}) => ({
  id: 'a1',
  launch_id: 'L1',
  contact_id: 'c1',
  caller_id: 'ana',
  assigned_at: '2026-11-01T10:00:00Z',
  ...o,
})
const llamada = (o = {}) => ({
  assignment_id: 'a1',
  caller_id: 'ana',
  actor_id: 'ana',
  tipo: 'estado',
  status: 'llamado',
  created_at: '2026-11-02T10:00:00Z',
  ...o,
})
const venta = (o = {}) => ({
  id: 's1',
  contact_id: 'c1',
  created_at: '2026-11-05T10:00:00Z',
  sale_date: '2026-11-05',
  refund_deadline_at: '2026-11-19',
  status: 'active',
  is_upsell: false,
  reservation_completed_at: null,
  payment_plan_method: 'tarjeta',
  ...o,
})
const calc = (o) =>
  ventasQueCuentan({ asignaciones: [asig()], eventos: [llamada()], ventas: [venta()], tramos: TRAMOS, ...o })

test('una venta cuenta si ELLA llamó antes de la venta', () => {
  const [v] = calc({})
  assert.equal(v.callerId, 'ana')
  assert.equal(v.numero, 1)
  assert.equal(v.importe, 50)
})

test('no cuenta: sin llamada, solo WhatsApp, llamada posterior a la venta o asignado después', () => {
  assert.equal(calc({ eventos: [] }).length, 0)
  assert.equal(calc({ eventos: [llamada({ status: 'whatsapp' })] }).length, 0, 'un WhatsApp no es una llamada')
  assert.equal(calc({ eventos: [llamada({ created_at: '2026-11-06T10:00:00Z' })] }).length, 0)
  assert.equal(calc({ asignaciones: [asig({ assigned_at: '2026-11-06T10:00:00Z' })] }).length, 0)
  assert.equal(calc({ eventos: [llamada({ tipo: 'nota' })] }).length, 0)
})

test('el cambio de estado que hace un gestor NO cuenta como llamada de ella', () => {
  assert.equal(calc({ eventos: [llamada({ actor_id: 'manager' })] }).length, 0)
  assert.equal(calc({ eventos: [llamada({ actor_id: null })] }).length, 0)
})

test('una venta registrada tarde no convierte en válida una llamada posterior al cierre real', () => {
  const tardia = venta({ sale_date: '2026-11-03', created_at: '2026-11-10T10:00:00Z' })
  assert.equal(instanteDeVenta(tardia), Date.parse('2026-11-03T23:59:59.999Z'))
  assert.equal(calc({ ventas: [tardia], eventos: [llamada({ created_at: '2026-11-08T10:00:00Z' })] }).length, 0)
  assert.equal(calc({ ventas: [tardia], eventos: [llamada({ created_at: '2026-11-02T10:00:00Z' })] }).length, 1)
})

test('D8: una reserva sin completar no comisiona; completada, sí. Ni upsell ni venta no activa', () => {
  assert.equal(calc({ ventas: [venta({ payment_plan_method: 'reserva' })] }).length, 0)
  assert.equal(
    calc({ ventas: [venta({ payment_plan_method: 'reserva', reservation_completed_at: '2026-11-06T00:00:00Z' })] })
      .length,
    1
  )
  assert.equal(calc({ ventas: [venta({ is_upsell: true })] }).length, 0)
  assert.equal(calc({ ventas: [venta({ status: 'refunded' })] }).length, 0)
})

test('D9: quien tiene pays_commissions = false no genera comisión', () => {
  assert.equal(calc({ exentos: new Set(['ana']) }).length, 0)
  assert.equal(calc({ exentos: new Set(['otra']) }).length, 1)
})

test('tras una reasignación, las llamadas de la anterior no le dan la comisión a la nueva', () => {
  // El lead es ahora de Bea (reasignado el día 3); la única llamada la hizo Ana el día 2.
  const reasignado = asig({ caller_id: 'bea', assigned_at: '2026-11-03T10:00:00Z' })
  assert.equal(calc({ asignaciones: [reasignado] }).length, 0)
  const conLlamadaDeBea = [
    llamada(),
    llamada({ caller_id: 'bea', actor_id: 'bea', created_at: '2026-11-04T10:00:00Z' }),
  ]
  const [v] = calc({ asignaciones: [reasignado], eventos: conLlamadaDeBea })
  assert.equal(v.callerId, 'bea')
})

test('si el lead pasó por dos lanzamientos, la venta es de UNA: la asignación más reciente con llamada', () => {
  const r = ventasQueCuentan({
    asignaciones: [asig(), asig({ id: 'a2', launch_id: 'L2', caller_id: 'bea', assigned_at: '2026-11-03T10:00:00Z' })],
    eventos: [
      llamada(),
      llamada({ assignment_id: 'a2', caller_id: 'bea', actor_id: 'bea', created_at: '2026-11-04T10:00:00Z' }),
    ],
    ventas: [venta()],
    tramos: TRAMOS,
  })
  assert.equal(r.length, 1, 'nunca se paga dos veces')
  assert.equal(r[0].callerId, 'bea')
  assert.equal(r[0].launchId, 'L2')
})

test('los tramos se numeran por persona y lanzamiento, por orden de venta', () => {
  const asignaciones = [1, 2, 3].map((i) => asig({ id: `a${i}`, contact_id: `c${i}` }))
  const eventos = [1, 2, 3].map((i) => llamada({ assignment_id: `a${i}` }))
  const ventas = [3, 1, 2].map((i) =>
    venta({
      id: `s${i}`,
      contact_id: `c${i}`,
      created_at: `2026-11-0${4 + i}T10:00:00Z`,
      sale_date: `2026-11-0${4 + i}`,
    })
  )
  const r = ventasQueCuentan({ asignaciones, eventos, ventas, tramos: TRAMOS })
  assert.deepEqual(
    r.map((v) => [v.saleId, v.numero, v.importe]),
    [
      ['s1', 1, 50],
      ['s2', 2, 50],
      ['s3', 3, 80],
    ]
  )
})

test('«Tu dinero»: lo firme y lo que aún está en plazo de desistimiento van separados', () => {
  const ventas = [
    { importe: 50, finDesistimiento: '2026-11-01' },
    { importe: 50, finDesistimiento: '2026-11-10' },
    { importe: 80, finDesistimiento: '2026-11-20' },
    { importe: 80, finDesistimiento: null },
    { importe: null, finDesistimiento: null },
  ]
  assert.deepEqual(resumenDinero(ventas, '2026-11-10'), { firme: 130, enVentana: 130, ventas: 5, sinImporte: 1 })
})

test('mes de liquidación = día 1 del mes siguiente a la venta, también en diciembre', () => {
  assert.equal(mesDeLiquidacion('2026-11-05T10:00:00Z'), '2026-12-01')
  assert.equal(mesDeLiquidacion('2026-12-31T23:00:00Z'), '2027-01-01')
})

// ── Sincronización con el ledger ────────────────────────────────────────────

const unicos = {
  commissions: [['sale_id', 'participant_type', 'direction']],
  cold_calling_assignments: [['launch_id', 'contact_id']],
  cold_calling_settings: [['tenant_id']],
}
function escenario(extra = {}) {
  return sbMemoria(
    {
      cold_calling_settings: [
        { tenant_id: T, tramos: TRAMOS, tanda: 2, pedir_mas_si_quedan: 1, objetivo_confirmados: null },
      ],
      cold_calling_assignments: [
        { ...asig(), tenant_id: T, first_called_at: '2026-11-02T10:00:00Z', status: 'llamado' },
      ],
      cold_calling_events: [{ ...llamada(), tenant_id: T }],
      sales: [{ ...venta(), tenant_id: T, payment_plans: { method: 'tarjeta' } }],
      commissions: [],
      tenant_members: [],
      ...extra,
    },
    { unicos }
  )
}

test('sincronizar: crea la comisión una sola vez y repetirlo no cambia nada (idempotente)', async () => {
  const { sb, datos } = escenario()
  assert.deepEqual(await sincronizarComisionesColdCalling(sb, T), {
    creadas: 1,
    ajustadas: 0,
    canceladas: 0,
    sinTramos: false,
  })
  const c = datos.commissions[0]
  assert.equal(c.tenant_id, T)
  assert.equal(c.user_id, 'ana')
  assert.equal(c.participant_type, 'cold_caller')
  assert.equal(c.commission_amount, 50)
  assert.equal(c.percent, 0, 'importe fijo: no es un porcentaje sobre una base')
  assert.equal(c.status, 'pending')
  assert.equal(c.liquidation_month, '2026-12-01')
  assert.deepEqual(await sincronizarComisionesColdCalling(sb, T), {
    creadas: 0,
    ajustadas: 0,
    canceladas: 0,
    sinTramos: false,
  })
  assert.equal(datos.commissions.length, 1)
})

test('sincronizar: una venta que deja de contar cancela la comisión pendiente, nunca una liquidada', async () => {
  const { sb, datos } = escenario()
  await sincronizarComisionesColdCalling(sb, T)
  datos.sales[0].status = 'refunded'
  assert.equal((await sincronizarComisionesColdCalling(sb, T)).canceladas, 1)
  assert.equal(datos.commissions[0].status, 'cancelled')
  // Vuelve a contar → se reactiva en pendiente.
  datos.sales[0].status = 'active'
  assert.equal((await sincronizarComisionesColdCalling(sb, T)).ajustadas, 1)
  assert.equal(datos.commissions[0].status, 'pending')
  // Ya pagada: aunque la venta se anule, no se toca (D4/D7).
  datos.commissions[0].status = 'liquidated'
  datos.sales[0].status = 'refunded'
  assert.deepEqual(await sincronizarComisionesColdCalling(sb, T), {
    creadas: 0,
    ajustadas: 0,
    canceladas: 0,
    sinTramos: false,
  })
  assert.equal(datos.commissions[0].status, 'liquidated')
})

test('sincronizar: sin tramos no crea ni cancela nada; y no toca filas de otra subcuenta ni de otro tipo', async () => {
  const ajenas = [
    {
      id: 'x1',
      tenant_id: 'otra',
      sale_id: 'sx',
      user_id: 'u',
      participant_type: 'cold_caller',
      direction: 'positive',
      status: 'pending',
      commission_amount: 9,
    },
    {
      id: 'x2',
      tenant_id: T,
      sale_id: 's1',
      user_id: 'u',
      participant_type: 'closer',
      direction: 'positive',
      status: 'pending',
      commission_amount: 9,
    },
    {
      id: 'x3',
      tenant_id: T,
      sale_id: 'sz',
      user_id: 'u',
      participant_type: 'cold_caller',
      direction: 'negative',
      status: 'pending',
      commission_amount: 9,
    },
  ]
  const { sb, datos } = escenario({ commissions: ajenas.map((c) => ({ ...c })) })
  await sincronizarComisionesColdCalling(sb, T)
  for (const a of ajenas) assert.equal(datos.commissions.find((c) => c.id === a.id).status, 'pending', a.id)
  assert.equal(
    datos.commissions.filter(
      (c) => c.tenant_id === T && c.participant_type === 'cold_caller' && c.direction === 'positive'
    ).length,
    1
  )

  const vacio = escenario({
    cold_calling_settings: [],
    commissions: [
      {
        id: 'p',
        tenant_id: T,
        sale_id: 's1',
        user_id: 'ana',
        participant_type: 'cold_caller',
        direction: 'positive',
        status: 'pending',
        commission_amount: 50,
      },
    ],
  })
  assert.equal((await sincronizarComisionesColdCalling(vacio.sb, T)).sinTramos, true)
  assert.equal(vacio.datos.commissions[0].status, 'pending', 'borrar los tramos no cancela en bloque lo pendiente')
})

test('el gancho tras una venta nunca lanza y no hace nada si el contacto no pasó por cold calling', async () => {
  const { sb, datos } = escenario()
  await sincronizarTrasVenta(sb, T, 'contacto-sin-asignacion')
  assert.equal(datos.commissions.length, 0)
  await sincronizarTrasVenta(sb, T, 'c1')
  assert.equal(datos.commissions.length, 1)
  const roto = sbMemoria(
    {},
    {
      errores: {
        cold_calling_assignments: {
          select: { code: '42P01', message: 'relation "cold_calling_assignments" does not exist' },
        },
      },
    }
  )
  await assert.doesNotReject(
    () => sincronizarTrasVenta(roto.sb, T, 'c1'),
    'migración sin aplicar: se sale sin romper el cobro'
  )
})

test('el motor de comisiones llama al gancho en el cobro y en la reconciliación, y no borra filas sin cobro', () => {
  const src = readFileSync('lib/commissions/generate.ts', 'utf8')
  assert.equal(src.match(/await sincronizarTrasVenta\(/g)?.length, 2)
  assert.match(
    src,
    /c\.status !== 'liquidated' && c\.collection_id\)/,
    'la reconciliación solo borra positivas CON cobro'
  )
})

// ── Reparto ─────────────────────────────────────────────────────────────────

test('la bolsa se ordena por nota (sin nota al final) y no repite a la misma persona', () => {
  const c = (contactId, quality, joinedAt, email, phone) => ({ contactId, quality, joinedAt, email, phone })
  const orden = ordenarBolsa([
    c('sin', null, '2026-11-03T00:00:00Z', null, '600000001'),
    c('viejo', 8, '2026-11-01T00:00:00Z', null, '600000002'),
    c('nuevo', 8, '2026-11-02T00:00:00Z', null, '600000003'),
    c('top', 9.5, '2026-11-01T00:00:00Z', null, '600000004'),
  ])
  assert.deepEqual(
    orden.map((x) => x.contactId),
    ['top', 'nuevo', 'viejo', 'sin']
  )
  assert.equal(tel9('+34 600 000 001'), '600000001')
  const unicosOk = sinRepetidos(
    [
      c('a', 9, '', 'Uno@Ejemplo.com', '+34600000001'),
      c('b', 8, '', 'uno@ejemplo.com', '611111111'),
      c('c', 7, '', null, '600 000 001'),
      c('d', 6, '', null, '622222222'),
    ],
    10
  )
  assert.deepEqual(
    unicosOk.map((x) => x.contactId),
    ['a', 'd'],
    'mismo email o mismo teléfono = misma persona'
  )
})

const LANZ = {
  id: 'L1',
  slug: 'l',
  label: 'Evento',
  fecha: '2026-11-20',
  estado: 'abierto',
  abierto: true,
  abiertoAt: '2026-11-01T00:00:00Z',
  cerradoAt: null,
}
const AJ = { tramos: TRAMOS, tanda: 2, pedirMasSiQuedan: 1, objetivoConfirmados: null, guardado: true }
function bolsa(n, extra = {}) {
  return sbMemoria(
    {
      contact_launches: Array.from({ length: n }, (_, i) => ({
        id: `cl${i}`,
        tenant_id: T,
        launch_id: 'L1',
        contact_id: `c${i}`,
        created_at: `2026-11-0${1 + (i % 8)}T10:00:00Z`,
        contacts: { email: `p${i}@ejemplo.com`, phone: `60000000${i}`, qualification: null },
      })),
      cold_calling_assignments: [],
      cold_calling_events: [],
      appointments: [],
      sales: [],
      ...extra,
    },
    { unicos }
  )
}

test('dame más: entrega una tanda, deja rastro y no reparte dos veces el mismo lead', async () => {
  const { sb, datos } = bolsa(5)
  const r1 = await pedirMas(sb, T, { launch: LANZ, callerId: 'ana', actorId: 'ana', ajustes: AJ })
  assert.deepEqual(r1, { asignados: 2, quedanEnBolsa: 3 })
  const r2 = await pedirMas(sb, T, { launch: LANZ, callerId: 'bea', actorId: 'bea', ajustes: AJ })
  assert.equal(r2.asignados, 2)
  const contactos = datos.cold_calling_assignments.map((a) => a.contact_id)
  assert.equal(new Set(contactos).size, 4, 'ningún lead en dos listas')
  assert.ok(datos.cold_calling_assignments.every((a) => a.tenant_id === T))
  assert.equal(datos.cold_calling_events.filter((e) => e.tipo === 'asignado').length, 4)
})

test('dame más: se niega si aún quedan muchos por llamar, salvo que lo fuerce un gestor', async () => {
  const { sb, datos } = bolsa(6)
  await pedirMas(sb, T, { launch: LANZ, callerId: 'ana', actorId: 'ana', ajustes: AJ })
  for (const a of datos.cold_calling_assignments) a.status = 'pendiente'
  await assert.rejects(
    () => pedirMas(sb, T, { launch: LANZ, callerId: 'ana', actorId: 'ana', ajustes: AJ }),
    /Aún te quedan 2 leads/
  )
  const r = await pedirMas(sb, T, {
    launch: LANZ,
    callerId: 'ana',
    actorId: 'jefa',
    ajustes: AJ,
    forzar: true,
    cantidad: 3,
  })
  assert.equal(r.asignados, 3)
  assert.ok(
    datos.cold_calling_events.some((e) => e.actor_id === 'jefa'),
    'queda quién lo repartió'
  )
})

test('dame más: no reparte un lanzamiento cerrado, ni a quien ya agendó o compró, ni sin teléfono', async () => {
  const cerrado = { ...LANZ, abierto: false, estado: 'cerrado' }
  await assert.rejects(
    () => pedirMas(bolsa(3).sb, T, { launch: cerrado, callerId: 'ana', actorId: 'ana', ajustes: AJ }),
    /lanzamiento abierto/
  )
  const { sb, datos } = bolsa(4, {
    appointments: [
      { id: 'ap', tenant_id: T, contact_id: 'c0', status: 'scheduled', created_at: '2026-11-05T00:00:00Z' },
    ],
    sales: [
      {
        id: 'sv',
        tenant_id: T,
        contact_id: 'c1',
        status: 'active',
        created_at: '2026-11-05T00:00:00Z',
        reservation_completed_at: null,
        payment_plans: null,
      },
    ],
  })
  datos.contact_launches[2].contacts.phone = null
  const r = await pedirMas(sb, T, { launch: LANZ, callerId: 'ana', actorId: 'ana', ajustes: { ...AJ, tanda: 10 } })
  assert.equal(r.asignados, 1)
  assert.equal(datos.cold_calling_assignments[0].contact_id, 'c3')
})

// ── Operaciones sobre un lead ───────────────────────────────────────────────

function conLead(o = {}) {
  return sbMemoria(
    {
      cold_calling_assignments: [
        {
          id: 'a1',
          tenant_id: T,
          launch_id: 'L1',
          contact_id: 'c1',
          caller_id: 'ana',
          status: 'pendiente',
          notes: null,
          recordatorio_at: null,
          intentos: 0,
          first_called_at: null,
          confirmed_at: null,
          updated_at: '2026-11-01T00:00:00.000Z',
          ...o,
        },
      ],
      cold_calling_events: [],
      sales: [],
    },
    { unicos }
  )
}

test('la cold caller marca sus leads: cuenta el intento, fija la primera llamada y deja historial', async () => {
  const { sb, datos } = conLead()
  await actualizarLead(sb, T, { assignmentId: 'a1', actorId: 'ana', esGestor: false, status: 'no_contesta' })
  const r = await actualizarLead(sb, T, {
    assignmentId: 'a1',
    actorId: 'ana',
    esGestor: false,
    status: 'confirmado',
    notes: ' Va seguro ',
  })
  assert.equal(r.intentos, 2)
  assert.ok(r.first_called_at && r.confirmed_at)
  assert.equal(r.notes, 'Va seguro')
  assert.deepEqual(
    datos.cold_calling_events.map((e) => [e.tipo, e.status ?? null, e.actor_id, e.caller_id, e.tenant_id]),
    [
      ['estado', 'no_contesta', 'ana', 'ana', T],
      ['estado', 'confirmado', 'ana', 'ana', T],
      ['nota', null, 'ana', 'ana', T],
    ]
  )
})

test('no puede tocar el lead de otra, ni el de otra subcuenta, ni poner un estado inventado', async () => {
  const { sb } = conLead()
  await assert.rejects(
    () => actualizarLead(sb, T, { assignmentId: 'a1', actorId: 'bea', esGestor: false, status: 'llamado' }),
    /no está en tu lista/
  )
  await assert.rejects(
    () => actualizarLead(sb, 'otra', { assignmentId: 'a1', actorId: 'ana', esGestor: false, status: 'llamado' }),
    /no encontrado/
  )
  await assert.rejects(
    () => actualizarLead(sb, T, { assignmentId: 'a1', actorId: 'ana', esGestor: false, status: 'vendido' }),
    /Estado no válido/
  )
  await assert.rejects(
    () => actualizarLead(sb, T, { assignmentId: 'a1', actorId: 'ana', esGestor: false, recordatorioAt: 'mañana' }),
    /recordatorio no válida/
  )
})

test('un gestor puede corregir un estado, pero no cuenta como llamada de ella', async () => {
  const { sb, datos } = conLead()
  const r = await actualizarLead(sb, T, { assignmentId: 'a1', actorId: 'jefa', esGestor: true, status: 'llamado' })
  assert.equal(r.intentos, 0)
  assert.equal(r.first_called_at, null)
  assert.equal(datos.cold_calling_events[0].actor_id, 'jefa')
  assert.equal(datos.cold_calling_events[0].caller_id, 'ana')
})

test('si otra persona cambió el lead mientras lo editabas, 409 en vez de pisarlo', async () => {
  const { sb } = conLead()
  await assert.rejects(
    () =>
      actualizarLead(sb, T, {
        assignmentId: 'a1',
        actorId: 'ana',
        esGestor: false,
        status: 'llamado',
        esperado: '2026-10-31T00:00:00.000Z',
      }),
    (e) => e.status === 409
  )
})

test('reasignar: con motivo, a una cold caller activa, y nunca un lead que ya tiene venta', async () => {
  const validos = new Set(['ana', 'bea'])
  const { sb, datos } = conLead({ status: 'llamado', intentos: 3, first_called_at: '2026-11-02T00:00:00Z' })
  const base = { assignmentId: 'a1', actorId: 'jefa', callersValidos: validos }
  await assert.rejects(() => reasignarLead(sb, T, { ...base, nuevoCallerId: 'bea', motivo: ' ' }), /motivo/)
  await assert.rejects(
    () => reasignarLead(sb, T, { ...base, nuevoCallerId: 'intrusa', motivo: 'baja' }),
    /no es una cold caller activa/
  )
  await assert.rejects(
    () => reasignarLead(sb, T, { ...base, nuevoCallerId: 'ana', motivo: 'baja' }),
    /ya es de esa persona/
  )
  const r = await reasignarLead(sb, T, { ...base, nuevoCallerId: 'bea', motivo: 'Ana está de baja' })
  assert.equal(r.caller_id, 'bea')
  assert.equal(r.status, 'pendiente')
  assert.equal(r.first_called_at, null, 'la nueva empieza de cero: lo de la anterior queda en el historial')
  assert.deepEqual(
    [datos.cold_calling_events[0].tipo, datos.cold_calling_events[0].nota, datos.cold_calling_events[0].actor_id],
    ['reasignado', 'Ana está de baja', 'jefa']
  )

  const vendido = conLead()
  vendido.datos.sales.push({ id: 's', tenant_id: T, contact_id: 'c1', status: 'active' })
  await assert.rejects(
    () => reasignarLead(vendido.sb, T, { ...base, nuevoCallerId: 'bea', motivo: 'cambio' }),
    /ya tiene una venta/
  )
})

// ── Permisos y coherencia con la base de datos ──────────────────────────────

test('quién gestiona y quién configura: el manager de cold calling gestiona pero no toca el dinero', () => {
  const a = (role, administraTenant = false) => ({ role, administraTenant })
  assert.equal(esCaller(a('cold_caller')), true)
  assert.equal(puedeGestionarColdCalling(a('cold_caller')), false)
  assert.equal(puedeGestionarColdCalling(a('cold_calling_manager')), true)
  assert.equal(puedeConfigurarColdCalling(a('cold_calling_manager')), false)
  assert.equal(puedeConfigurarColdCalling(a('manager')), false)
  assert.equal(puedeConfigurarColdCalling(a('director')), true)
  assert.equal(puedeConfigurarColdCalling(a(null, true)), true)
  assert.equal(puedeGestionarColdCalling(a('closer')), false)
})

test('los estados del código son exactamente los del CHECK de la migración', () => {
  const sql = readFileSync('supabase/migrations/20261110110000_cold_calling.sql', 'utf8')
  const check = /status\s+TEXT NOT NULL DEFAULT 'pendiente' CHECK \(status IN \(([^)]+)\)\)/.exec(sql)
  assert.ok(check, 'se encuentra el CHECK de status')
  const enBd = check[1]
    .split(',')
    .map((s) => s.trim().replace(/'/g, ''))
    .sort()
  assert.deepEqual(enBd, [...ESTADO_IDS].sort())
  assert.ok(!ESTADOS_LLAMADA.includes('whatsapp') && !ESTADOS_LLAMADA.includes('pendiente'))
})

test('nada específico de una empresa en el módulo: ni importes, ni dominios, ni identificadores fijos', () => {
  for (const f of ['estados', 'policy', 'config', 'comisiones', 'reparto', 'operaciones', 'panel']) {
    const src = readFileSync(`lib/cold-calling/${f}.ts`, 'utf8')
    assert.doesNotMatch(src, /https?:\/\//, `${f}: sin URLs`)
    assert.doesNotMatch(src, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, `${f}: sin UUIDs fijos`)
    assert.doesNotMatch(src, /importe:\s*\d/, `${f}: sin importes de comisión en código`)
  }
  const cfg = readFileSync('lib/cold-calling/config.ts', 'utf8')
  assert.match(cfg, /tramos: \[\],/, 'los ajustes iniciales no traen tramos')
})
