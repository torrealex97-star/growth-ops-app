// Algoritmo de decisão de lanzamiento (SPEC-18 §44), codificado para que la certificación no
// se improvise en una conversación ni en una hoja de cálculo: la PR de certificación lo invoca
// con los gates reales. Fail-closed: un gate sin estado conocido no aprueba nada, y un estado
// CONDITIONAL solo vale con control compensatorio documentado y en un alcance acotado.
// El módulo JAMÁS despliega: devuelve una decisión; la autorización humana final es del dueño.

export type EstadoGate = 'PASS' | 'FAIL' | 'BLOCKED' | 'UNVERIFIED' | 'OUT_OF_SCOPE' | 'CONDITIONAL'

export type AlcanceLanzamiento = 'interno' | 'beta_privada' | 'publico'

export type Gate = {
  id: string
  estado: EstadoGate
  /** Control compensatorio documentado (exigido cuando el estado es CONDITIONAL). */
  control?: string
}

export type DecisionLanzamiento =
  | { decision: 'NOT_READY'; motivos: string[] }
  | { decision: 'CONDITIONAL_READY'; alcance: AlcanceLanzamiento; condiciones: string[] }
  | { decision: 'LAUNCH_READY'; alcance: 'publico' }

const ESTADOS_VALIDOS: readonly EstadoGate[] = ['PASS', 'FAIL', 'BLOCKED', 'UNVERIFIED', 'OUT_OF_SCOPE', 'CONDITIONAL']

/**
 * Aplica la política del §44 con el alcance SOLICITADO como input:
 *   · FAIL / BLOCKED / UNVERIFIED en cualquier gate ⇒ NOT_READY
 *     (UNVERIFIED = evidencia insuficiente, no «probablemente bien»).
 *   · CONDITIONAL sin control documentado ⇒ NOT_READY.
 *   · CONDITIONAL en alcance 'publico' ⇒ NOT_READY (los condicionales solo valen en alcances
 *     acotados: interno o beta_privada).
 *   · Todo PASS/OUT_OF_SCOPE ⇒ LAUNCH_READY (solo conseguible en alcance publico).
 *   · CONDITIONAL válidos en interno/beta_privada ⇒ CONDITIONAL_READY con sus condiciones.
 *   · Sin gates, gate corrupto o estado desconocido ⇒ NOT_READY (nunca inventar aprobación).
 */
export function decidirLanzamiento(gates: Gate[], alcance: AlcanceLanzamiento): DecisionLanzamiento {
  if (!Array.isArray(gates) || gates.length === 0) {
    return { decision: 'NOT_READY', motivos: ['sin_gates_evaluados'] }
  }

  const motivos: string[] = []
  const condiciones: string[] = []

  for (const gate of gates) {
    const id = gate && typeof gate.id === 'string' ? gate.id : '?'
    if (!gate || !ESTADOS_VALIDOS.includes(gate.estado)) {
      return { decision: 'NOT_READY', motivos: [`gate_invalido:${id}`] }
    }
    if (gate.estado === 'FAIL' || gate.estado === 'BLOCKED') {
      motivos.push(`${gate.id}:${gate.estado}`)
    } else if (gate.estado === 'UNVERIFIED') {
      motivos.push(`${gate.id}:evidencia_insuficiente`)
    } else if (gate.estado === 'CONDITIONAL') {
      if (alcance === 'publico') {
        motivos.push(`${gate.id}:condicional_no_valido_en_publico`)
      } else if (!gate.control || gate.control.trim() === '') {
        motivos.push(`${gate.id}:condicional_sin_control`)
      } else {
        condiciones.push(`${gate.id}:control=${gate.control}`)
      }
    }
    // PASS y OUT_OF_SCOPE no aportan condiciones ni motivos: son evidencia completa o exclusión
    // decidida explícitamente.
  }

  if (motivos.length > 0) {
    return { decision: 'NOT_READY', motivos }
  }
  if (condiciones.length === 0) {
    // Sin condicionales, el estado es aprobable al nivel del alcance solicitado (y si el
    // alcance era público, eso es LAUNCH_READY para la SPEC).
    return alcance === 'publico'
      ? { decision: 'LAUNCH_READY', alcance: 'publico' }
      : { decision: 'CONDITIONAL_READY', alcance, condiciones: [] }
  }
  return { decision: 'CONDITIONAL_READY', alcance, condiciones }
}

/**
 * Gates G1-G18 en su estado evaluado el 13-oct (evidencia de cada uno en
 * FINAL_LAUNCH_CERTIFICATION_REPORT.md §G): refleja la realidad medida, no el deseo.
 * El alcance comercial queda NOT_READY porque G6 (billing) está FAIL: la clasificación no lo cura.
 */
export const GATES_EVALUADOS_13OCT: Gate[] = [
  { id: 'G1_isolamento_tenant', estado: 'PASS' }, // batería 11/11 + escáner en CI
  {
    id: 'G2_integridad_datos',
    estado: 'CONDITIONAL',
    control: 'Calendly fuera de raw_events (H-1) compensado con actas en audit_logs',
  },
  {
    id: 'G3_atribucion',
    estado: 'CONDITIONAL',
    control: 'sin motor común de clasificadores; cobertura declarada en pantalla',
  },
  { id: 'G4_revenue_cash', estado: 'PASS' }, // cash canónico con refunds PROBADO
  { id: 'G5_onboarding', estado: 'BLOCKED' }, // self-serve MISSING (decisión SPEC-13 §5)
  { id: 'G6_billing_saas', estado: 'FAIL' }, // módulo entero MISSING (grep 0)
  { id: 'G7_dashboards', estado: 'PASS' }, // 74 ficheros de métricas
  {
    id: 'G8_integraciones',
    estado: 'CONDITIONAL',
    control: 'sin auditoría concurrente de escritura; sandbox unverified',
  },
  { id: 'G9_ai', estado: 'CONDITIONAL', control: 'contenido hostil 12 tests; sin dataset de evaluación' },
  { id: 'G10_mcp', estado: 'UNVERIFIED' }, // servidor completo; cliente real sin sesión probada
  { id: 'G11_automations', estado: 'BLOCKED' }, // growth_signals DDL pendiente de aprobación
  { id: 'G12_platform_admin', estado: 'CONDITIONAL', control: 'RBAC fail-closed con super_admin binario' },
  { id: 'G13_backups_dr', estado: 'FAIL' }, // restore drill nunca ejecutado
  { id: 'G14_cicd', estado: 'PASS' },
  { id: 'G15_performance', estado: 'UNVERIFIED' }, // sin pruebas de carga (staging ausente)
  { id: 'G16_observabilidad', estado: 'CONDITIONAL', control: 'actas + advisors; sin alertas automáticas' },
  { id: 'G17_privacidad', estado: 'CONDITIONAL', control: 'erase_person probado; retención sin política final' },
  { id: 'G18_ux', estado: 'CONDITIONAL', control: 'QA visual parcial del 1-oct' },
]
