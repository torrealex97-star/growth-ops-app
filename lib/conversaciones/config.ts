// CONFIGURACIÓN DEL AGENTE DE SETTING POR SUBCUENTA (pura). Se guarda como JSON en `integration_settings`
// (clave `conversaciones_agente`, sin secretos) y se LEE siempre a través de `leerConfigAgente`, que nunca
// confía en lo guardado: un campo roto cae al valor seguro (apagado, sin enlace, topes bajos).

import { CONFIG_POR_DEFECTO, type ConfigAgente } from './agente'
import type { GuionAgente, Objecion, PasoGuion } from './redactor'

export const CLAVE_CONFIG_AGENTE = 'conversaciones_agente'

export type ConfigCompleta = { config: ConfigAgente; guion: GuionAgente }

export const GUION_POR_DEFECTO: GuionAgente = {
  negocio: 'tu negocio',
  tono: 'cercano y profesional',
  pasos: [],
  objeciones: [],
  enlaceAgenda: null,
  hechosPermitidos: [],
}

type Json = Record<string, unknown>
const esObjeto = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
const cadena = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
const entero = (v: unknown, min: number, max: number, defecto: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : defecto

/** Solo https y sin credenciales: es lo único que el agente puede enviar como enlace. */
export function enlaceSeguro(v: unknown): string | null {
  const t = cadena(v, 500)
  if (!t) return null
  try {
    const u = new URL(t)
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null
  } catch {
    return null
  }
}

function leerHorario(v: unknown): ConfigAgente['horario'] {
  if (!esObjeto(v)) return null
  const desde = typeof v.desde === 'number' ? v.desde : NaN
  const hasta = typeof v.hasta === 'number' ? v.hasta : NaN
  const zona = cadena(v.zona, 60)
  if (!zona || !(desde >= 0 && desde <= 24) || !(hasta >= 0 && hasta <= 24) || desde === hasta) return null
  return { desde, hasta, zona }
}

function leerPasos(v: unknown): PasoGuion[] {
  if (!Array.isArray(v)) return []
  return v
    .slice(0, 12)
    .map((p): PasoGuion | null => {
      if (!esObjeto(p)) return null
      const clave = cadena(p.clave, 40)
      const objetivo = cadena(p.objetivo, 200)
      if (!clave || !objetivo || !/^[a-z0-9_]+$/.test(clave)) return null
      const pregunta = cadena(p.pregunta, 300)
      return { clave, objetivo, ...(pregunta ? { pregunta } : {}) }
    })
    .filter((p): p is PasoGuion => p !== null)
}

function leerObjeciones(v: unknown): Objecion[] {
  if (!Array.isArray(v)) return []
  return v
    .slice(0, 20)
    .map((o): Objecion | null => {
      if (!esObjeto(o)) return null
      const disparador = cadena(o.disparador, 120)
      const respuesta = cadena(o.respuesta, 400)
      return disparador && respuesta ? { disparador, respuesta } : null
    })
    .filter((o): o is Objecion => o !== null)
}

export function leerConfigAgente(guardado: unknown): ConfigCompleta {
  let j: unknown = guardado
  if (typeof guardado === 'string') {
    try {
      j = JSON.parse(guardado)
    } catch {
      j = null
    }
  }
  if (!esObjeto(j)) return { config: { ...CONFIG_POR_DEFECTO }, guion: { ...GUION_POR_DEFECTO } }
  const config: ConfigAgente = {
    // Solo un `true` explícito lo activa.
    activo: j.activo === true,
    permitirAutonomo: j.permitirAutonomo === true,
    maxSeguidosSinRespuesta: entero(j.maxSeguidosSinRespuesta, 1, 5, CONFIG_POR_DEFECTO.maxSeguidosSinRespuesta),
    maxEnviosDia: entero(j.maxEnviosDia, 1, 2000, CONFIG_POR_DEFECTO.maxEnviosDia),
    horario: leerHorario(j.horario),
    repartoAutomatico: j.repartoAutomatico === true,
  }
  const guion: GuionAgente = {
    negocio: cadena(j.negocio, 120) ?? GUION_POR_DEFECTO.negocio,
    tono: cadena(j.tono, 200) ?? GUION_POR_DEFECTO.tono,
    pasos: leerPasos(j.pasos),
    objeciones: leerObjeciones(j.objeciones),
    enlaceAgenda: enlaceSeguro(j.enlaceAgenda),
    hechosPermitidos: Array.isArray(j.hechosPermitidos)
      ? j.hechosPermitidos
          .map((h) => cadena(h, 240))
          .filter((h): h is string => !!h)
          .slice(0, 20)
      : [],
  }
  return { config, guion }
}

/** Lo que se GUARDA a partir de lo que envía el panel: pasa por la misma lectura segura y se re-serializa. */
export function aGuardable(entrada: unknown): string {
  const { config, guion } = leerConfigAgente(entrada)
  return JSON.stringify({ ...config, ...guion })
}
