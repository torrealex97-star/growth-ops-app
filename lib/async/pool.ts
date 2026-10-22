// Concurrencia acotada sin dependencias: n tareas a la vez, resultados EN EL ORDEN de entrada.
// Para lecturas independientes a un proveedor (p. ej. 200 payment_intents de Stripe) sin lanzarlas
// todas de golpe ni una a una.
export async function mapConLimite<T, R>(
  items: readonly T[],
  limite: number,
  fn: (item: T, indice: number) => Promise<R>
): Promise<R[]> {
  const resultados = new Array<R>(items.length)
  let siguiente = 0
  const trabajador = async () => {
    while (siguiente < items.length) {
      const i = siguiente++
      resultados[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limite, items.length)) }, trabajador))
  return resultados
}
