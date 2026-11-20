#!/usr/bin/env node
/**
 * Auditoría de dependencias de PRODUCCIÓN con excepciones explícitas y caducables.
 *
 * Equivale a `npm audit --omit=dev --audit-level=high`, salvo para los avisos listados en EXCEPCIONES:
 * cada una exige motivo y fecha de caducidad; pasada la fecha vuelve a bloquear. Cualquier aviso alto
 * o crítico que NO esté en la lista sigue rompiendo CI.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Excepciones vigentes. Vacía desde el 20-nov-2026: la de `picomatch` (GHSA-fc5q-39xc-vjpf) se retiró al subir
 * `@sentry/nextjs`, que dejó de arrastrar la versión vulnerable. Para añadir una: { ghsa, paquete, motivo, caduca }
 * (la caducidad es obligatoria; pasada la fecha el gate vuelve a bloquear).
 */
export const EXCEPCIONES = []

const SEVERIDADES_BLOQUEANTES = new Set(['high', 'critical'])

/** Devuelve { bloqueantes, exceptuados, caducadas } a partir del JSON de `npm audit`. */
export function evaluar(auditoria, hoy = new Date(), excepciones = EXCEPCIONES) {
  const bloqueantes = []
  const exceptuados = []
  const caducadas = []
  const vistos = new Set()
  for (const [paquete, vuln] of Object.entries(auditoria.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== 'object' || !SEVERIDADES_BLOQUEANTES.has(via.severity)) continue
      const ghsa = (via.url ?? '').split('/').pop()
      const clave = `${paquete}:${ghsa}`
      if (vistos.has(clave)) continue
      vistos.add(clave)
      const regla = excepciones.find((e) => e.ghsa === ghsa)
      if (!regla) bloqueantes.push({ paquete, ghsa, severidad: via.severity })
      else if (new Date(regla.caduca) < hoy) caducadas.push({ paquete, ghsa, caduca: regla.caduca })
      else exceptuados.push({ paquete, ghsa, caduca: regla.caduca })
    }
  }
  return { bloqueantes, exceptuados, caducadas }
}

function ejecutar() {
  let salida
  try {
    salida = execFileSync('npm', ['audit', '--omit=dev', '--json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  } catch (err) {
    salida = err.stdout // npm audit sale con código 1 cuando hay avisos
    if (!salida) throw err
  }
  const { bloqueantes, exceptuados, caducadas } = evaluar(JSON.parse(salida))
  for (const e of exceptuados) console.log(`EXCEPTUADO ${e.paquete} ${e.ghsa} (caduca ${e.caduca})`)
  for (const c of caducadas)
    console.error(`EXCEPCIÓN CADUCADA ${c.paquete} ${c.ghsa} (caducó ${c.caduca}): revisar o renovar`)
  for (const b of bloqueantes) console.error(`BLOQUEANTE ${b.paquete} ${b.ghsa} (${b.severidad})`)
  if (bloqueantes.length || caducadas.length) process.exit(1)
  console.log('Auditoría de producción OK')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) ejecutar()
