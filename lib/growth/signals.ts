// CAPA DE SEÑALES DE GROWTH (SPEC-15, PR-1) — determinista, sin LLM, sin BD.
//
// Por qué existe: el motor de insights existente (lib/ai/insights/detectors.ts) detecta
// anomalías de CAC/ROAS y redacta el brief con IA. Esta capa vive por debajo, en el límite
// OBSERVE → DIAGNOSE: convierte métricas canónicas en SEÑALES con evidencia, muestra mínima
// y cobertura de datos — y se NIEGA a emitir una señal cuando no puede comprobarla (un hueco
// no es un cero; la regla de la casa desde siempre: no fabricar comparaciones con null).
//
// El LLM no entra aquí. La IA solo explicará señales YA detectadas (SPEC-15 PR-5), igual que
// detectors.ts redacta anomalías ya medidas. Nunca decide si hubo caída.

export type Severidad = 'info' | 'warning' | 'critical'
export type Confianza = 'baja' | 'media' | 'alta'

/** Periodo de fechas ISO YYYY-MM-DD, comparable exclusivamente por rango. */
export type Periodo = { from: string; to: string }

export type GrowthSignal = {
  estado: 'detectada'
  tipo: string
  /** Estable para el dedupe de persistencia (PR-3): misma señal en la misma ventana ⇒ un solo caso. */
  fingerprint: string
  severidad: Severidad
  confianza: Confianza
  titulo: string
  /** Métricas afectadas con su valor observado (nunca inventado: lo que llegó NULL sale NULL). */
  evidencia: {
    metrica: string
    actual: number | null
    baseline: number | null
    muestraActual: number
    muestraBaseline: number
  }
}

export type Peligro = {
  estado: 'sin_senal' | 'no_evaluable'
  razon: string
}

// ─── Umbrales documentados (no score opaco, §21 del prompt): cada uno con su motivo. ───────
const MUESTRAS_MIN = 20
const COBERTURA_MIN = 0.8
const CAIDA_PTS_WARNING = 10
const CAIDA_PTS_CRITICAL = 20

export type EntradaShowRate = {
  periodoActual: Periodo
  periodoBaseline: Periodo
  /** Agendas del periodo elegibles (todas: las agendas sin outcome pesan en la cobertura, no en el cociente). */
  agendasElegiblesActual: number | null
  agendasElegiblesBaseline: number | null
  /** Agendas con `result` a已知 (no NULL): la cobertura protege de la "caída" falsa del §6.4. */
  outcomesConocidosActual: number | null
  showsActual: number | null
  showsBaseline: number | null
  syncSano: boolean
  definicionEstable: boolean
}

const nowe = 'show_rate_caida'

/**
 * ¿Cayó el Show Rate de verdad?
 * Orden de descarte (regla SPEC-15 §5/§6): sync → definición → agregados ausentes →
 * muestras mínimas → cobertura de outcomes → comparación porcentual. Con MAS puntos de muestra:
 * warning entre 10 y 20, critical por encima de 20.
 */
export function detectarCaidaShowRate(e: EntradaShowRate): GrowthSignal | Peligro {
  if (!e.syncSano)
    return noEvaluable('El estado de sincronización está degradado: los dos periodos pueden no estar aún cargados.')
  if (!e.definicionEstable)
    return noEvaluable('La definición de "show" cambió en el periodo: la comparación sería entre cosas distintas.')

  if (e.agendasElegiblesActual === null || e.agendasElegiblesBaseline === null) {
    return noEvaluable('Falta el agregado de agendas de uno de los dos periodos: un hueco no es un cero.')
  }
  const n = e.agendasElegiblesActual
  const nBase = e.agendasElegiblesBaseline

  if (n < MUESTRAS_MIN || nBase < MUESTRAS_MIN) {
    return noEvaluable(`Muestra insuficiente para comparar (${n} y ${nBase} agendas; mínimo ${MUESTRAS_MIN}).`)
  }

  if (e.outcomesConocidosActual === null || e.outcomesConocidosActual < n * COBERTURA_MIN) {
    const cobertura = e.outcomesConocidosActual === null ? 'sin dato' : `${e.outcomesConocidosActual}/${n}`
    return noEvaluable(
      `Cobertura de outcomes insuficiente (${cobertura}): una "caída" con agendas sin resolver (crono vacía) es la falsa alarma clásica del §6.4 del prompt.`
    )
  }
  if (e.showsActual === null || e.showsBaseline === null) {
    return noEvaluable('Falta el agregado de shows de uno de los dos periodos.')
  }

  const rateActual = e.showsActual / n
  const rateBase = e.showsBaseline / nBase
  const caida = rateBase - rateActual
  if (caida < CAIDA_PTS_WARNING / 100) {
    return { estado: 'sin_senal', razon: `Sin caída material (${voDe(rateActual)} vs ${voDe(rateBase)}).` }
  }

  const confianza: Confianza = n < 50 || nBase < 50 ? 'media' : 'alta'
  return {
    estado: 'detectada',
    tipo: nowe,
    fingerprint: `${nowe}:${e.periodoBaseline.to}:${e.periodoActual.to}`,
    severidad: caida >= CAIDA_PTS_CRITICAL / 100 ? 'critical' : 'warning',
    confianza,
    titulo: `El Show Rate bajó de ${voDe(rateBase)} a ${voDe(rateActual)}`,
    evidencia: {
      metrica: 'show_rate',
      actual: rateActual,
      baseline: rateBase,
      muestraActual: n,
      muestraBaseline: nBase,
    },
  }
}

function noEvaluable(razon: string): Peligro {
  return { estado: 'no_evaluable', razon }
}

const voDe = (rate: number) => `${Math.round(rate * 100)}%`
