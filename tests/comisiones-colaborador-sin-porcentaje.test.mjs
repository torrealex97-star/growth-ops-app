import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { porcentajePorDefecto, resolveSaleAttribution } from '../lib/commissions/attribution.ts'
import { MAX_VENTAS_RECALCULO, recalcularVentasTrasAsignar } from '../lib/commissions/reasignar-colaborador.ts'

const leer = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// Cliente Supabase mínimo: cada tabla devuelve lo que se le diga; registra los UPDATE.
function fake(tablas) {
  const updates = []
  const from = (nombre) => {
    const t = tablas[nombre] ?? {}
    const b = {
      select: () => b,
      eq: () => b,
      order: () => b,
      limit: () => b,
      not: () => b,
      in: () => b,
      maybeSingle: async () => ({ data: t.single ?? null, error: null }),
      update: (patch) => {
        updates.push({ tabla: nombre, patch })
        return { eq: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 'v' }], error: null }) }) }) }
      },
      then: (res) => res({ data: t.rows ?? [], error: null }),
    }
    return b
  }
  return { sb: { from }, updates }
}

const venta = (extra = {}) => ({
  id: 'v1',
  contact_id: 'c1',
  setter_id: 's1',
  affiliate_id: 'u-colab',
  affiliate_commission_percent: null,
  ...extra,
})

// Caso real (21-nov): dos ventas con colaboradora asignada y % vacío → 0 comisiones y «por pagar» a cero, sin aviso.
test('venta con colaborador y sin %: al reasignar se completa con el % por defecto de su ficha', async () => {
  const { sb, updates } = fake({ collaborator_profiles: { single: { default_commission_percent: '10.00' } } })
  const patch = await resolveSaleAttribution(sb, venta(), 't1', { completarPorcentaje: true })
  assert.deepEqual(patch, { affiliate_commission_percent: 10 })
  assert.deepEqual(updates, [{ tabla: 'sales', patch: { affiliate_commission_percent: 10 } }])
})

test('sin % en la ficha, vale el del usuario (Configuración › Usuarios)', async () => {
  const { sb } = fake({
    collaborator_profiles: { single: { default_commission_percent: null } },
    users: { single: { default_affiliate_commission_percent: 15 } },
  })
  assert.equal(await porcentajePorDefecto(sb, 't1', 'u-colab'), 15)
})

test('sin % en ningún sitio NO se inventa uno (el llamante avisa): no se escribe nada', async () => {
  const { sb, updates } = fake({
    collaborator_profiles: { single: { default_commission_percent: null } },
    users: { single: { default_affiliate_commission_percent: null } },
  })
  assert.deepEqual(await resolveSaleAttribution(sb, venta(), 't1', { completarPorcentaje: true }), {})
  assert.deepEqual(updates, [])
})

// Revisión de código: rellenar % en cualquier reparación generaría comisiones retroactivas que nadie decidió.
test('sin la petición explícita NO se completa el % de una venta que ya tenía afiliado (no retroactivo)', async () => {
  const { sb, updates } = fake({ collaborator_profiles: { single: { default_commission_percent: 10 } } })
  assert.deepEqual(await resolveSaleAttribution(sb, venta(), 't1'), {})
  assert.deepEqual(updates, [])
})

test('un % ya puesto (incluido 0 %) no se toca nunca', async () => {
  for (const pct of [20, 0]) {
    const { sb, updates } = fake({ collaborator_profiles: { single: { default_commission_percent: 10 } } })
    // setter y afiliado presentes: no hay nada que deducir
    assert.deepEqual(await resolveSaleAttribution(sb, venta({ affiliate_commission_percent: pct }), 't1'), {})
    assert.deepEqual(updates, [])
  }
})

test('afiliado deducido del contacto sin % en la ficha: toma el del usuario en el mismo paso', async () => {
  const { sb, updates } = fake({
    contact_attributions: {
      single: { collaborator_id: 'p1', collaborator_attribution_blocked: false },
    },
    collaborator_profiles: { single: { user_id: 'u-colab', default_commission_percent: null } },
    users: { single: { default_affiliate_commission_percent: 10 } },
  })
  const patch = await resolveSaleAttribution(sb, venta({ affiliate_id: null }), 't1')
  assert.deepEqual(patch, { affiliate_id: 'u-colab', affiliate_commission_percent: 10 })
  assert.equal(updates.length, 1)
})

function fakeVentas(ids, error = null) {
  const b = {
    select: () => b,
    eq: () => b,
    neq: () => b,
    limit: () => b,
    then: (res) => res({ data: error ? null : ids.map((id) => ({ id })), error }),
  }
  return { from: () => b }
}
const resultado = (extra = {}) => ({
  created: 0,
  deleted: 0,
  keptLiquidated: 0,
  afiliadoSinPorcentaje: false,
  afiliadoId: 'u-colab',
  atribucion: {},
  ...extra,
})

test('reasignar: reconstruye SOLO al colaborador, completa el % y suma lo creado', async () => {
  const llamadas = []
  const r = await recalcularVentasTrasAsignar({
    sb: fakeVentas(['a', 'b']),
    tenantId: 't1',
    contactId: 'c1',
    colaboradorUserId: 'u-colab',
    estadoPerfil: 'active',
    reconciliar: async (_sb, _t, id, _also, opts) => {
      llamadas.push({ id, opts })
      return resultado({ created: id === 'a' ? 2 : 1 })
    },
  })
  assert.deepEqual(
    llamadas.map((l) => l.opts),
    [
      { soloUsuarioId: 'u-colab', completarPorcentaje: true },
      { soloUsuarioId: 'u-colab', completarPorcentaje: true },
    ]
  )
  assert.equal(r.ventasRevisadas, 2)
  assert.equal(r.comisionesNuevas, 3)
  assert.deepEqual(r.warnings, [])
  assert.equal(r.detalle.length, 2, 'queda detalle para la auditoría')
})

test('reasignar: avisa si falta el % (solo si el afiliado sin % ES el colaborador), si no está activo y si falla', async () => {
  const sin = await recalcularVentasTrasAsignar({
    sb: fakeVentas(['a', 'b', 'c']),
    tenantId: 't1',
    contactId: 'c1',
    colaboradorUserId: 'u-colab',
    estadoPerfil: 'invited',
    reconciliar: async (_s, _t, id) =>
      resultado(
        id === 'c' ? { afiliadoSinPorcentaje: true, afiliadoId: 'otra-persona' } : { afiliadoSinPorcentaje: true }
      ),
  })
  assert.equal(sin.warnings.length, 2)
  assert.match(sin.warnings[0], /«invited», no activo/)
  assert.match(
    sin.warnings[1],
    /^2 ventas de este contacto tienen a este colaborador/,
    'la venta de un tercero no cuenta'
  )

  const roto = await recalcularVentasTrasAsignar({
    sb: fakeVentas([], { message: 'boom' }),
    tenantId: 't1',
    contactId: 'c1',
    colaboradorUserId: 'u-colab',
    estadoPerfil: 'active',
  })
  assert.match(roto.warnings[0], /La atribución se guardó, pero no se pudieron recalcular.*boom/)
  const sinUsuario = await recalcularVentasTrasAsignar({
    sb: fakeVentas(['a']),
    tenantId: 't1',
    contactId: 'c1',
    colaboradorUserId: null,
    estadoPerfil: 'active',
    reconciliar: async () => assert.fail('sin usuario no se reconcilia'),
  })
  assert.match(sinUsuario.warnings[0], /no tiene usuario asociado/)
})

test('reasignar: tiene tope de ventas y de tiempo, y lo declara en vez de cortarse a medias', async () => {
  const muchas = Array.from({ length: MAX_VENTAS_RECALCULO + 1 }, (_, i) => `v${i}`)
  const tope = await recalcularVentasTrasAsignar({
    sb: fakeVentas(muchas),
    tenantId: 't1',
    contactId: 'c1',
    colaboradorUserId: 'u-colab',
    estadoPerfil: 'active',
    reconciliar: async () => resultado(),
  })
  assert.equal(tope.ventasRevisadas, MAX_VENTAS_RECALCULO)
  assert.match(tope.warnings.at(-1), /Quedan 1 venta\(s\)/)

  let reloj = 0
  const lento = await recalcularVentasTrasAsignar({
    sb: fakeVentas(['a', 'b', 'c']),
    tenantId: 't1',
    contactId: 'c1',
    colaboradorUserId: 'u-colab',
    estadoPerfil: 'active',
    ahora: () => reloj,
    reconciliar: async () => {
      reloj += 20_000
      return resultado()
    },
  })
  assert.equal(lento.ventasRevisadas, 2)
  assert.match(lento.warnings.at(-1), /Quedan 1 venta\(s\)/)
})

test('la ruta usa el recálculo acotado y audita lo que escribe', () => {
  const ruta = leer('app/api/[tenant]/evergreen/colaboradores/attribution/route.ts')
  assert.match(ruta, /recalcularVentasTrasAsignar\(/)
  assert.match(ruta, /action: 'collaborator_attribution_recalc'/)
  assert.match(ruta, /if \(recalcAuditErr\)/)
  const motor = leer('lib/commissions/generate.ts')
  assert.match(motor, /c\.user_id === opts\.soloUsuarioId/, 'no se borran las comisiones (aprobadas) de otros')
  assert.match(motor, /!noComisionan\.has\(s\.affiliate_id\)/, 'D9: un exento no genera aviso de «falta %»')
})

test('las pantallas muestran los avisos en vez de dejar «por pagar» a cero sin explicación', () => {
  const contacto = leer('app/[tenant]/crm/contactos/[id]/page.tsx')
  assert.match(contacto, /data\?\.warnings/)
  assert.match(contacto, /toast\.warning\(aviso/)
  const edicion = leer('app/[tenant]/ventas/registro/[id]/page.tsx')
  assert.match(edicion, /data\.afiliadoSinPorcentaje/)
  const todo = leer('app/api/[tenant]/evergreen/sales/reconcile-all/route.ts')
  assert.match(todo, /sinPorcentaje/)
  const motor = leer('lib/commissions/generate.ts')
  assert.match(motor, /afiliadoSinPorcentaje =\s*!!s\.affiliate_id &&\s*s\.affiliate_commission_percent == null/)
})
