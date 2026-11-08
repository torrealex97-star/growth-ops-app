import { useCallback, useRef, useState } from 'react'

const MAX_PASOS = 50
/** Cambios seguidos de la misma clave dentro de este tiempo (p. ej. un deslizador) cuentan como un solo paso. */
const VENTANA_MS = 1200

/**
 * Historial de deshacer/rehacer en memoria (se pierde al cambiar de historia o recargar). El autoguardado no depende de él:
 * lo que se ve ya está guardado; deshacer solo vuelve a guardar el estado anterior.
 */
export function useHistorial<T>() {
  const pasado = useRef<{ valor: T; clave?: string; t: number }[]>([])
  const futuro = useRef<T[]>([])
  const [largos, setLargos] = useState({ p: 0, f: 0 })
  const sync = () => setLargos({ p: pasado.current.length, f: futuro.current.length })

  /** Guarda el estado ANTERIOR a un cambio. */
  const registrar = useCallback((previo: T, clave?: string) => {
    const ahora = Date.now()
    const ultimo = pasado.current[pasado.current.length - 1]
    if (clave && ultimo?.clave === clave && ahora - ultimo.t < VENTANA_MS) ultimo.t = ahora
    else {
      pasado.current.push({ valor: previo, clave, t: ahora })
      if (pasado.current.length > MAX_PASOS) pasado.current.shift()
    }
    futuro.current = []
    sync()
  }, [])

  const deshacer = useCallback((actual: T): T | null => {
    const u = pasado.current.pop()
    if (!u) return null
    futuro.current.push(actual)
    sync()
    return u.valor
  }, [])

  const rehacer = useCallback((actual: T): T | null => {
    const v = futuro.current.pop()
    if (v === undefined) return null
    pasado.current.push({ valor: actual, t: 0 })
    sync()
    return v
  }, [])

  const limpiar = useCallback(() => {
    pasado.current = []
    futuro.current = []
    sync()
  }, [])

  return { registrar, deshacer, rehacer, limpiar, puedeDeshacer: largos.p > 0, puedeRehacer: largos.f > 0 }
}
