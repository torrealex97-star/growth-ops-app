import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { esNombrePrevioReal, nombresPreviosPorCampana } from '../lib/campaigns/nombres-previos.ts'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const leer = (p) => readFileSync(join(raiz, p), 'utf8')

test('esNombrePrevioReal: utm vacío u orgánico nunca es rename', () => {
  assert.equal(esNombrePrevioReal(null, 'Campaña X'), false)
  assert.equal(esNombrePrevioReal('', 'Campaña X'), false)
  assert.equal(esNombrePrevioReal('   ', 'Campaña X'), false)
})

test('esNombrePrevioReal: la codificación del proveedor NO es rename (Calendly "+" y caso/espacios)', () => {
  assert.equal(esNombrePrevioReal('🟢+AGENDA+|+COLD+LOOKALIKE+AUDIENCE', '🟢 AGENDA | COLD LOOKALIKE AUDIENCE'), false)
  assert.equal(
    esNombrePrevioReal('  🟢 AGENDA   | Cold Lookalike Audience ', '🟢 AGENDA | COLD LOOKALIKE AUDIENCE'),
    false
  )
})

test('esNombrePrevioReal: nombre distinto normalizado SÍ es rename real', () => {
  // Caso REAL de producción: la Copia renombrada en Meta deja el utm crudo congelado.
  assert.equal(esNombrePrevioReal('🟢+AGENDA+|+COLD+AUDIENCE+-+Copia', '🟢 AGENDA | COLD LOOKALIKE AUDIENCE'), true)
})

// Supabase falso: encadenable (select → eq → not → not) pero thenable igual que el real.
function supabaseFalso({ camps = [], contacts = [] } = {}) {
  const builder = (filas) => {
    const b = {
      select: () => b,
      eq: () => b,
      not: () => b,
      or: () => b,
      order: () => b,
      range: () => b,
      then: (res, rej) => Promise.resolve({ data: filas, error: null }).then(res, rej),
    }
    return b
  }
  return {
    from: (table) => builder(table === 'campaigns' ? camps : contacts),
  }
}

test('nombresPreviosPorCampana: agrupa por campaña y deja fuera el nombre actual y los vacíos', async () => {
  const sb = supabaseFalso({
    camps: [
      { id: 'c-look', name: '🟢 AGENDA | COLD LOOKALIKE AUDIENCE' },
      { id: 'c-copia', name: '🟢 AGENDA | COLD AUDIENCE - Copia' },
    ],
    contacts: [
      {
        contact_id: 'c1',
        contacts: { campaign_id: 'c-look', tenant_id: 'tenant-1' },
        first_utm_campaign: '🟢+AGENDA+|+COLD+AUDIENCE+-+Copia',
        utm_campaign: null,
      },
      {
        contact_id: 'c2',
        contacts: { campaign_id: 'c-look', tenant_id: 'tenant-1' },
        first_utm_campaign: '🟢+AGENDA+|+COLD+AUDIENCE+-+Copia',
        utm_campaign: null,
      },
      {
        contact_id: 'c3',
        contacts: { campaign_id: 'c-look', tenant_id: 'tenant-1' },
        first_utm_campaign: null,
        utm_campaign: null,
      }, // sin utm: fuera
      // mismo nombre actual (case/espacios): NO es rename
      {
        contact_id: 'c4',
        contacts: { campaign_id: 'c-look', tenant_id: 'tenant-1' },
        first_utm_campaign: '🟢 AGENDA | COLD LOOKALIKE AUDIENCE',
        utm_campaign: null,
      },
      {
        contact_id: 'c5',
        contacts: { campaign_id: 'c-copia', tenant_id: 'tenant-1' },
        first_utm_campaign: null,
        utm_campaign: '🟢+AGENDA+|+COLD+AUDIENCE',
      },
    ],
  })
  const mapa = await nombresPreviosPorCampana(sb, 'tenant-1')
  assert.deepEqual(mapa['c-look'].previos, ['🟢+AGENDA+|+COLD+AUDIENCE+-+Copia'])
  assert.equal(mapa['c-look'].conteo['🟢+AGENDA+|+COLD+AUDIENCE+-+Copia'], 2)
  assert.deepEqual(mapa['c-copia'].previos, ['🟢+AGENDA+|+COLD+AUDIENCE'])
})

test('nombresPreviosPorCampana: sin campañas no lee contactos (early return, sin query huérfana)', async () => {
  const sb = supabaseFalso({ camps: [] })
  const mapa = await nombresPreviosPorCampana(sb, 'tenant-1')
  assert.deepEqual(mapa, {})
})

test('nombresPreviosPorCampana: ordena previos por evidencia (más contactos primero)', async () => {
  const sb = supabaseFalso({
    camps: [{ id: 'c1', name: 'Nueva' }],
    contacts: [
      {
        contact_id: 'k1',
        contacts: { campaign_id: 'c1', tenant_id: 'tenant-1' },
        first_utm_campaign: 'Vieja A',
        utm_campaign: null,
      },
      {
        contact_id: 'k2',
        contacts: { campaign_id: 'c1', tenant_id: 'tenant-1' },
        first_utm_campaign: 'Vieja B',
        utm_campaign: null,
      },
      {
        contact_id: 'k3',
        contacts: { campaign_id: 'c1', tenant_id: 'tenant-1' },
        first_utm_campaign: 'Vieja B',
        utm_campaign: null,
      },
    ],
  })
  const mapa = await nombresPreviosPorCampana(sb, 'tenant-1')
  assert.deepEqual(mapa['c1'].previos, ['Vieja B', 'Vieja A'])
})

test('readonly: el módulo no escribe en base (solo from().select(), cero insert/update/rpc)', () => {
  const src = leer('lib/campaigns/nombres-previos.ts')
  assert.doesNotMatch(src, /\.insert\(|\.update\(|\.upsert\(|\.rpc\(/)
})

test('el endpoint es por tenant con requireTenant y service-role, y proyecta columnas mínimas', () => {
  const route = leer('app/api/[tenant]/evergreen/meta/campaigns/nombres-previos/route.ts')
  assert.match(route, /requireTenant/)
  assert.match(route, /SUPABASE_SERVICE_ROLE_KEY/)
  const mod = leer('lib/campaigns/nombres-previos.ts')
  assert.match(mod, /select\('id, name'\)/, 'proyección mínima de campaigns')
  assert.match(mod, /from\('contact_attributions'\)/, 'la UTM se lee desde su tabla canónica')
  assert.match(mod, /contacts!inner\(campaign_id, tenant_id\)/, 'campaign_id se resuelve por la FK del contacto')
  assert.match(mod, /\.range\(/, 'la lectura histórica está paginada')
})
