import test from 'node:test'
import assert from 'node:assert/strict'
import { rangoDeMeses, enRangoMeses, mesDePagoPrevisto, resumenPagosPorMes } from '@/lib/commissions/facturas-meses'

test('presets por meses', () => {
  assert.deepEqual(rangoDeMeses('trimestre', '2026-11'), { desde: '2026-10', hasta: '2026-12' })
  assert.deepEqual(rangoDeMeses('semestre', '2026-11'), { desde: '2026-07', hasta: '2026-12' })
  assert.deepEqual(rangoDeMeses('semestre', '2026-03'), { desde: '2026-01', hasta: '2026-06' })
  assert.deepEqual(rangoDeMeses('anterior', '2026-01'), { desde: '2025-12', hasta: '2025-12' })
  assert.deepEqual(rangoDeMeses('rango', '2026-11', '2026-09', '2026-08'), { desde: '2026-08', hasta: '2026-09' })
})
test('pago previsto y rango', () => {
  assert.equal(mesDePagoPrevisto('2026-11'), '2026-12')
  assert.equal(mesDePagoPrevisto('2026-12'), '2027-01')
  assert.ok(enRangoMeses('2026-09', { desde: '2026-08', hasta: '2026-09' }))
})
test('resumen: liquidated = pagado, approved = por pagar, ignora otros roles y canceladas', () => {
  const base = { created_at: '2026-10-05T00:00:00Z' }
  const r = resumenPagosPorMes([
    {
      ...base,
      participant_type: 'collaborator',
      status: 'liquidated',
      commission_amount: 100,
      liquidation_month: '2026-09-01',
    },
    {
      ...base,
      participant_type: 'collaborator',
      status: 'approved',
      commission_amount: 50,
      liquidation_month: '2026-12-01',
    },
    {
      ...base,
      participant_type: 'collaborator',
      status: 'liquidated',
      commission_amount: 10,
      direction: 'negative',
      liquidation_month: '2026-09-01',
    },
    {
      ...base,
      participant_type: 'closer',
      status: 'liquidated',
      commission_amount: 999,
      liquidation_month: '2026-09-01',
    },
    {
      ...base,
      participant_type: 'collaborator',
      status: 'cancelled',
      commission_amount: 7,
      liquidation_month: '2026-09-01',
    },
  ])
  assert.deepEqual(r, [
    { mes: '2026-09', pagado: 90, porPagar: 0 },
    { mes: '2026-12', pagado: 0, porPagar: 50 },
  ])
})

test('presets de periodo por meses: mes anterior y semestre (fronteras del negocio)', async () => {
  const { getPeriodRange } = await import('@/lib/filters/period')
  const ahora = new Date('2026-11-06T12:00:00Z')
  const ini = (r) => r.from.toISOString().slice(0, 10)
  assert.equal(ini(getPeriodRange('prev_month', '', '', {}, ahora)), '2026-09-30') // 1 oct 00:00 Madrid = 30 sep UTC
  assert.equal(ini(getPeriodRange('semester', '', '', {}, ahora)), '2026-06-30') // 1 jul 00:00 Madrid
  assert.equal(ini(getPeriodRange('semester', '', '', {}, new Date('2026-03-10T12:00:00Z'))), '2025-12-31')
})
