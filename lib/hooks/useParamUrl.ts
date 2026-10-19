'use client'

import { useCallback, useEffect, useState } from 'react'

// ESTADO DE UN FILTRO EN LA URL.
//
// Los filtros (periodo, estado, closer, búsqueda…) vivían solo en memoria: al recargar o al compartir el
// enlace se perdían, y «volver a la lista» dejaba la pantalla sin filtrar. Con el filtro en la URL, un
// enlace abre la pantalla ya filtrada y recargar no pierde nada.
//
// SIN DEPENDENCIA NUEVA (nuqs hacía lo mismo y más de lo que hace falta aquí). Se escribe con
// `history.replaceState`, que no recarga ni crea una entrada nueva en el historial, y se lee UNA vez al
// montar (en un efecto, para no desajustar la hidratación del servidor). Un valor que no esté entre los
// permitidos se ignora: un enlace manipulado no puede dejar la pantalla en un estado imposible.

/** URL resultante de fijar un parámetro; el valor por defecto (o vacío) lo QUITA para que la URL quede limpia. */
export function urlConParametro(href: string, clave: string, valor: string, porDefecto: string): string {
  const url = new URL(href)
  if (valor === porDefecto || valor === '') url.searchParams.delete(clave)
  else url.searchParams.set(clave, valor)
  return url.toString()
}

/** Valor de la URL si es válido; si no, `null` (se queda el valor por defecto). */
export function valorDeUrl(search: string, clave: string, permitidos?: readonly string[]): string | null {
  const v = new URLSearchParams(search).get(clave)
  if (v === null) return null
  if (permitidos && !permitidos.includes(v)) return null
  return v
}

export function useParamUrl<T extends string = string>(
  clave: string,
  porDefecto: T,
  permitidos?: readonly T[]
): [T, (valor: T) => void] {
  const [valor, setValor] = useState<T>(porDefecto)

  useEffect(() => {
    const v = valorDeUrl(window.location.search, clave, permitidos)
    if (v !== null) setValor(v as T)
    // Solo al montar: después manda el estado, y la URL se actualiza al escribirlo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave])

  const actualizar = useCallback(
    (nuevo: T) => {
      setValor(nuevo)
      try {
        window.history.replaceState(
          window.history.state,
          '',
          urlConParametro(window.location.href, clave, nuevo, porDefecto)
        )
      } catch {
        // Un entorno sin history (vista previa embebida) simplemente no refleja el filtro en la URL.
      }
    },
    [clave, porDefecto]
  )

  return [valor, actualizar]
}
