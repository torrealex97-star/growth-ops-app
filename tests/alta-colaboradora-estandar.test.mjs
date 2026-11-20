import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { necesitaTrackingCode, normalizarPorcentaje, presetDeRol, TRACKING_ROLES } from '@/lib/auth/role-presets'
import { asegurarFichaColaborador } from '@/lib/collaborators/provision'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')

// Cliente Supabase falso: registra inserts/updates y devuelve filas previas configurables.
function fakeSb({ previa = [], insertError = null } = {}) {
  const log = { inserts: [], updates: [] }
  const sb = {
    from(tabla) {
      return {
        select() {
          const q = { eq: () => q, limit: async () => ({ data: previa, error: null }) }
          return q
        },
        insert: async (fila) => {
          log.inserts.push({ tabla, fila })
          return { error: insertError }
        },
        update(valores) {
          return { eq: async () => (log.updates.push({ tabla, valores }), { error: null }) }
        },
      }
    },
  }
  return { sb, log }
}

test('preset de colaboradora: mínimo privilegio y comisiones SIEMPRE activas', () => {
  const p = presetDeRol('affiliate')
  assert.ok(p)
  assert.equal(p.dataScope, 'own', 'el default de la BD es team: un colaborador externo debe nacer en own')
  assert.equal(
    p.paysCommissions,
    true,
    'pays_commissions=false purga comisiones (MONEY.md D9): el preset nunca lo toca'
  )
  assert.equal(p.memberStatus, 'activo')
  assert.equal(p.membershipRole, 'member')
  assert.deepEqual(p.fichaColaborador, { estadoInicial: 'invited' })
})

test('los roles sin alta estándar propia no cambian de comportamiento', () => {
  for (const rol of ['closer', 'setter', 'admin', 'director', 'cold_caller', '', null, undefined]) {
    assert.equal(presetDeRol(rol), null)
  }
})

test('tracking_code: la lista vive en un único sitio', () => {
  assert.ok(necesitaTrackingCode('affiliate'))
  assert.ok(!necesitaTrackingCode('admin'))
  assert.deepEqual([...TRACKING_ROLES].sort(), ['affiliate', 'closer', 'cold_caller', 'setter'])
  for (const f of ['app/api/[tenant]/evergreen/invite/route.ts', 'app/[tenant]/settings/users/page.tsx']) {
    assert.doesNotMatch(sinComentarios(leer(f)), /const TRACKING_ROLES/, `${f} no debe duplicar TRACKING_ROLES`)
  }
})

test('normalizarPorcentaje: vacío, texto o fuera de rango no se guardan', () => {
  assert.equal(normalizarPorcentaje(''), null)
  assert.equal(normalizarPorcentaje(null), null)
  assert.equal(normalizarPorcentaje('abc'), null)
  assert.equal(normalizarPorcentaje(-1), null)
  assert.equal(normalizarPorcentaje(101), null)
  assert.equal(normalizarPorcentaje('12,5'), 12.5)
  assert.equal(normalizarPorcentaje(0), 0)
})

test('asegurarFichaColaborador crea la ficha y sincroniza el % en las dos tablas', async () => {
  const { sb, log } = fakeSb()
  const r = await asegurarFichaColaborador(
    sb,
    { tenantId: 't1', userId: 'u1', nombre: 'Ana', codigo: 'abc123', porcentaje: '15' },
    async () => 'NO_SE_USA'
  )
  assert.deepEqual(r, { ok: true, creada: true, codigo: 'ABC123' })
  assert.equal(log.inserts.length, 1)
  assert.equal(log.inserts[0].tabla, 'collaborator_profiles')
  assert.equal(log.inserts[0].fila.default_commission_percent, 15)
  assert.equal(log.inserts[0].fila.status, 'invited')
  assert.deepEqual(log.updates, [{ tabla: 'users', valores: { default_affiliate_commission_percent: 15 } }])
})

test('asegurarFichaColaborador genera código si no se da y deja el % en null sin tocar users', async () => {
  const { sb, log } = fakeSb()
  const r = await asegurarFichaColaborador(sb, { tenantId: 't1', userId: 'u1', nombre: null }, async () => 'gen99')
  assert.deepEqual(r, { ok: true, creada: true, codigo: 'GEN99' })
  assert.equal(log.inserts[0].fila.default_commission_percent, null)
  assert.equal(log.updates.length, 0)
})

test('asegurarFichaColaborador es idempotente: una ficha previa no se toca', async () => {
  const { sb, log } = fakeSb({ previa: [{ id: 'f1', code: 'VIEJO' }] })
  const r = await asegurarFichaColaborador(sb, { tenantId: 't1', userId: 'u1', nombre: 'Ana', porcentaje: 30 })
  assert.deepEqual(r, { ok: true, creada: false, codigo: 'VIEJO' })
  assert.equal(log.inserts.length, 0)
  assert.equal(log.updates.length, 0)
})

test('asegurarFichaColaborador propaga el error de la BD (no lo traga)', async () => {
  const { sb } = fakeSb({ insertError: { message: 'boom' } })
  const r = await asegurarFichaColaborador(sb, { tenantId: 't1', userId: 'u1', nombre: 'Ana', codigo: 'X' })
  assert.deepEqual(r, { ok: false, error: 'boom' })
})

test('las tres vías de alta usan el mismo helper y el preset (sin lógica duplicada)', () => {
  const invite = sinComentarios(leer('app/api/[tenant]/evergreen/invite/route.ts'))
  const usuarios = sinComentarios(leer('app/[tenant]/settings/users/page.tsx'))
  const colab = sinComentarios(leer('app/api/[tenant]/evergreen/colaboradores/route.ts'))
  assert.match(invite, /asegurarFichaColaborador\(/)
  assert.match(usuarios, /asegurarFichaColaborador\(/)
  assert.doesNotMatch(invite, /from\('collaborator_profiles'\)\s*\.insert/)
  assert.doesNotMatch(usuarios, /from\('collaborator_profiles'\)\.insert/)
  // La invitación y el alta directa fijan el preset solo en cuentas NUEVAS.
  assert.match(invite, /preset && linkType === 'invite'/)
  assert.match(colab, /presetAffiliate/)
  // Nadie escribe pays_commissions: false en el alta.
  for (const src of [invite, colab]) assert.doesNotMatch(src, /pays_commissions:\s*false/)
})
