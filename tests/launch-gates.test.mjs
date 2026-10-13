import assert from 'node:assert/strict'
import test from 'node:test'

import { decidirLanzamiento, GATES_EVALUADOS_13OCT } from '../lib/launch/gates.ts'

const G = (id, estado, control) => ({ id, estado, ...(control ? { control } : {}) })

test('sin gates no se aprueba nada (fail-closed, nunca LAUNCH_READY por defecto)', () => {
  const d = decidirLanzamiento([], 'publico')
  assert.equal(d.decision, 'NOT_READY')
  assert.deepEqual(d.motivos, ['sin_gates_evaluados'])
})

test('estado corrupto o desconocido ⇒ NOT_READY con el gate señalado', () => {
  const d = decidirLanzamiento([G('X1', 'PROBABLEMENTE_BIEN')], 'interno')
  assert.equal(d.decision, 'NOT_READY')
  assert.deepEqual(d.motivos, ['gate_invalido:X1'])
})

test('cualquier FAIL o BLOCKED bloquea el alcance pedido, sin importar el resto', () => {
  const gates = [G('A', 'PASS'), G('B', 'FAIL'), G('C', 'PASS')]
  const d = decidirLanzamiento(gates, 'publico')
  assert.equal(d.decision, 'NOT_READY')
  assert.deepEqual(d.motivos, ['B:FAIL'])
  const d2 = decidirLanzamiento([G('Z', 'BLOCKED')], 'beta_privada')
  assert.deepEqual(d2.motivos, ['Z:BLOCKED'])
})

test('UNVERIFIED es evidencia insuficiente: bloquea aunque «parezca bien»', () => {
  const d = decidirLanzamiento([G('K', 'UNVERIFIED')], 'beta_privada')
  assert.equal(d.decision, 'NOT_READY')
  assert.deepEqual(d.motivos, ['K:evidencia_insuficiente'])
})

// §44: CONDITIONAL_READY no existe para el lanzamiento público — allí todo debe ser PASS.
test('un CONDITIONAL en alcance público invalida el LAUNCH_READY, tenga control o no', () => {
  const conControl = decidirLanzamiento([G('C', 'CONDITIONAL', 'algun control')], 'publico')
  assert.equal(conControl.decision, 'NOT_READY')
  assert.deepEqual(conControl.motivos, ['C:condicional_no_valido_en_publico'])
  const sinControl = decidirLanzamiento([G('C', 'CONDITIONAL')], 'publico')
  assert.deepEqual(sinControl.motivos, ['C:condicional_no_valido_en_publico'])
})

test('un CONDITIONAL sin control compensatorio documentado bloquea en alcances acotados', () => {
  const d = decidirLanzamiento([G('D', 'CONDITIONAL')], 'beta_privada')
  assert.equal(d.decision, 'NOT_READY')
  assert.deepEqual(d.motivos, ['D:condicional_sin_control'])
})

test('todo PASS en público es LAUNCH_READY; en interno queda CONDITIONAL_READY sin condiciones', () => {
  const publico = decidirLanzamiento([G('A', 'PASS'), G('B', 'OUT_OF_SCOPE')], 'publico')
  assert.equal(publico.decision, 'LAUNCH_READY')
  assert.equal(publico.alcance, 'publico')
  const interno = decidirLanzamiento([G('A', 'PASS')], 'interno')
  assert.equal(interno.decision, 'CONDITIONAL_READY')
  assert.deepEqual(interno.condiciones, [])
})

test('CONDITIONAL válidos con control en beta_privada → CONDITIONAL_READY con las condiciones', () => {
  const d = decidirLanzamiento(
    [G('A', 'PASS'), G('B', 'CONDITIONAL', 'control B'), G('C', 'CONDITIONAL', 'control C')],
    'beta_privada'
  )
  assert.equal(d.decision, 'CONDITIONAL_READY')
  assert.equal(d.alcance, 'beta_privada')
  assert.deepEqual(d.condiciones, ['B:control=control B', 'C:control=control C'])
})

// La evaluación real del 13-oct: esto congela la decisión del informe (§M) en código contra
// futuras regresiones de gating (nadie puede «aprobar» cambiando solo el doc).
test('GATES_EVALUADOS_13OCT en público es NOT_READY por G6 (billing) y G13 (DR), no por opinión', () => {
  const d = decidirLanzamiento(GATES_EVALUADOS_13OCT, 'publico')
  assert.equal(d.decision, 'NOT_READY')
  assert.ok(d.motivos.includes('G6_billing_saas:FAIL'))
  assert.ok(d.motivos.includes('G13_backups_dr:FAIL'))
})

test('GATES_EVALUADOS_13OCT tal cual también bloquea el alcance interno (G10/G15 sin evidencia)', () => {
  const d = decidirLanzamiento(GATES_EVALUADOS_13OCT, 'interno')
  assert.equal(d.decision, 'NOT_READY')
  assert.ok(d.motivos.includes('G5_onboarding:BLOCKED'))
  assert.ok(d.motivos.includes('G10_mcp:evidencia_insuficiente'))
  assert.ok(d.motivos.includes('G15_performance:evidencia_insuficiente'))
})

// Alcance 1 del informe (operación interna ACTUAL): los gates fuera de ese alcance se
// declaran OUT_OF_SCOPE con decisión explícita — no se ignoran.
test('con las exclusiones de alcance explícitas, la operación interna queda CONDITIONAL_READY', () => {
  const d = decidirLanzamiento(
    [
      G('G1_isolamento_tenant', 'PASS'),
      G('G2_integridad_datos', 'CONDITIONAL', 'Calendly sin raw_events, compensado con actas'),
      G('G4_revenue_cash', 'PASS'),
      G('G7_dashboards', 'PASS'),
      G('G12_platform_admin', 'CONDITIONAL', 'RBAC fail-closed super_admin binario'),
      G('G14_cicd', 'PASS'),
      // Los gates comerciales/escalado quedan EXCLUIDOS del alcance con decisión del dueño y
      // controles que impiden su uso accidental (sin billing, sin crons nuevos, sin MCP vendido).
      G('G5_onboarding_selfserve', 'OUT_OF_SCOPE'),
      G('G6_billing_saas', 'OUT_OF_SCOPE'),
      G('G10_mcp', 'OUT_OF_SCOPE'),
      G('G15_performance', 'OUT_OF_SCOPE'),
      G('G13_backups_dr', 'CONDITIONAL', 'export manual documentado antes de migraciones; drill PENDIENTE'),
    ],
    'interno'
  )
  assert.equal(d.decision, 'CONDITIONAL_READY')
  assert.equal(d.alcance, 'interno')
  // El fixture declara exactamente 3 CONDITIONALs con control: G2, G12 y G13.
  assert.equal(d.condiciones.length, 3)
})
