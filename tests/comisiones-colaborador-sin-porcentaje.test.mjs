import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { porcentajePorDefecto, resolveSaleAttribution } from '../lib/commissions/attribution.ts'

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
  affiliate_id: 'u-liset',
  affiliate_commission_percent: null,
  ...extra,
})

// Caso real (21-nov): dos ventas con colaboradora asignada y % vacío → 0 comisiones y «por pagar» a cero, sin aviso.
test('venta con colaborador y sin %: se completa con el % por defecto de su ficha', async () => {
  const { sb, updates } = fake({ collaborator_profiles: { single: { default_commission_percent: '10.00' } } })
  const patch = await resolveSaleAttribution(sb, venta(), 't1')
  assert.deepEqual(patch, { affiliate_commission_percent: 10 })
  assert.deepEqual(updates, [{ tabla: 'sales', patch: { affiliate_commission_percent: 10 } }])
})

test('sin % en la ficha, vale el del usuario (Configuración › Usuarios)', async () => {
  const { sb } = fake({
    collaborator_profiles: { single: { default_commission_percent: null } },
    users: { single: { default_affiliate_commission_percent: 15 } },
  })
  assert.equal(await porcentajePorDefecto(sb, 't1', 'u-liset'), 15)
})

test('sin % en ningún sitio NO se inventa uno (el llamante avisa): no se escribe nada', async () => {
  const { sb, updates } = fake({
    collaborator_profiles: { single: { default_commission_percent: null } },
    users: { single: { default_affiliate_commission_percent: null } },
  })
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
    collaborator_profiles: { single: { user_id: 'u-liset', default_commission_percent: null } },
    users: { single: { default_affiliate_commission_percent: 10 } },
  })
  const patch = await resolveSaleAttribution(sb, venta({ affiliate_id: null }), 't1')
  assert.deepEqual(patch, { affiliate_id: 'u-liset', affiliate_commission_percent: 10 })
  assert.equal(updates.length, 1)
})

test('reasignar un colaborador recalcula sus ventas y avisa de lo que impedirá cobrar', () => {
  const ruta = leer('app/api/[tenant]/evergreen/colaboradores/attribution/route.ts')
  assert.match(ruta, /reconcileSaleCommissions\(sb, t\.tenantId,/)
  assert.match(ruta, /\.neq\('status', 'cancelled'\)/)
  assert.match(ruta, /afiliadoSinPorcentaje/)
  assert.match(ruta, /estadoPerfil !== 'active'/)
  // el fallo del recálculo no deshace la atribución ya auditada: se declara
  assert.match(ruta, /La atribución se guardó, pero no se pudieron recalcular/)
  // quitar el colaborador (null) no reconcilia nada
  assert.match(ruta, /if \(collaboratorId\) \{\s+if \(estadoPerfil/)
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
  assert.match(motor, /afiliadoSinPorcentaje = !!s\.affiliate_id && s\.affiliate_commission_percent == null/)
})
