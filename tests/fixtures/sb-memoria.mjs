// Cliente Supabase mínimo EN MEMORIA para tests de núcleo sin BD. Implementa el subconjunto del
// query builder que usan lib/launch y lib/cold-calling: filtros, orden, rango, conteo, insert,
// update, delete y upsert. Aplica de verdad los filtros (incluido tenant_id), así que un test que
// olvide el tenant ve filas ajenas y falla, que es justo lo que queremos detectar.
//
// `maxRows` imita el `max_rows` de PostgREST: ninguna lectura devuelve más filas que ese tope,
// pida lo que pida `.limit()`. Es el comportamiento que cortaba cifras sin avisar.

let secuencia = 0

export function sbMemoria(tablas = {}, opciones = {}) {
  const maxRows = opciones.maxRows ?? 1000
  const datos = {}
  for (const [nombre, filas] of Object.entries(tablas)) datos[nombre] = filas.map((f) => ({ ...f }))
  const registro = []

  const from = (tabla) => {
    datos[tabla] ??= []
    const filtros = []
    const orden = []
    let limite = null
    let rango = null
    let modo = 'select'
    let cambios = null
    let contar = false
    let soloCabecera = false
    let devolver = false
    let unico = null
    let opcionesUpsert = null

    const casa = (fila) => filtros.every((f) => f(fila))

    const ejecutar = () => {
      const errorForzado = opciones.errores?.[tabla]?.[modo]
      if (errorForzado) return { data: null, error: errorForzado, count: null }

      if (modo === 'insert' || modo === 'upsert') {
        const nuevas = (Array.isArray(cambios) ? cambios : [cambios]).map((f) => ({ ...f }))
        const claves = opciones.unicos?.[tabla] ?? []
        const insertadas = []
        for (const fila of nuevas) {
          const choque = claves.find((cols) =>
            datos[tabla].some((x) => cols.every((c) => x[c] != null && x[c] === fila[c]))
          )
          if (choque) {
            if (modo === 'upsert') {
              if (opcionesUpsert?.ignoreDuplicates) continue
              const existente = datos[tabla].find((x) => choque.every((c) => x[c] === fila[c]))
              Object.assign(existente, fila)
              insertadas.push(existente)
              continue
            }
            return { data: null, error: { code: '23505', message: 'duplicate key value' }, count: null }
          }
          fila.id ??= `id-${++secuencia}`
          fila.created_at ??= new Date().toISOString()
          datos[tabla].push(fila)
          insertadas.push(fila)
        }
        registro.push({ tabla, modo, filas: insertadas })
        return { data: devolver ? insertadas.map((f) => ({ ...f })) : null, error: null, count: null }
      }

      if (modo === 'update') {
        const tocadas = datos[tabla].filter(casa)
        for (const fila of tocadas) Object.assign(fila, cambios)
        registro.push({ tabla, modo, cambios, n: tocadas.length })
        return { data: devolver ? tocadas.map((f) => ({ ...f })) : null, error: null, count: null }
      }

      if (modo === 'delete') {
        const borradas = datos[tabla].filter(casa)
        datos[tabla] = datos[tabla].filter((f) => !casa(f))
        registro.push({ tabla, modo, n: borradas.length })
        return { data: devolver ? borradas : null, error: null, count: null }
      }

      let filas = datos[tabla].filter(casa)
      const total = filas.length
      for (const { col, asc } of [...orden].reverse()) {
        filas = [...filas].sort((a, b) => {
          if (a[col] === b[col]) return 0
          if (a[col] == null) return 1
          if (b[col] == null) return -1
          return (a[col] < b[col] ? -1 : 1) * (asc ? 1 : -1)
        })
      }
      if (rango) filas = filas.slice(rango[0], rango[1] + 1)
      if (limite != null) filas = filas.slice(0, limite)
      filas = filas.slice(0, maxRows)
      if (soloCabecera) return { data: null, error: null, count: contar ? total : null }
      const copia = filas.map((f) => ({ ...f }))
      if (unico) return { data: copia[0] ?? null, error: null, count: contar ? total : null }
      return { data: copia, error: null, count: contar ? total : null }
    }

    const q = {
      select: (_cols, o) => {
        if (modo === 'select') {
          contar = Boolean(o?.count)
          soloCabecera = Boolean(o?.head)
        } else devolver = true
        return q
      },
      insert: (filas) => ((modo = 'insert'), (cambios = filas), q),
      upsert: (filas, o) => ((modo = 'upsert'), (cambios = filas), (opcionesUpsert = o ?? null), q),
      update: (c) => ((modo = 'update'), (cambios = c), q),
      delete: () => ((modo = 'delete'), q),
      eq: (k, v) => (filtros.push((f) => f[k] === v), q),
      neq: (k, v) => (filtros.push((f) => f[k] !== v), q),
      in: (k, vs) => (filtros.push((f) => vs.includes(f[k])), q),
      gt: (k, v) => (filtros.push((f) => f[k] != null && f[k] > v), q),
      gte: (k, v) => (filtros.push((f) => f[k] != null && f[k] >= v), q),
      lt: (k, v) => (filtros.push((f) => f[k] != null && f[k] < v), q),
      lte: (k, v) => (filtros.push((f) => f[k] != null && f[k] <= v), q),
      is: (k, v) => (filtros.push((f) => (v === null ? f[k] == null : f[k] === v)), q),
      not: (k, op, v) => {
        if (op === 'is' && v === null) filtros.push((f) => f[k] != null)
        else if (op === 'in') filtros.push((f) => !String(v).replace(/[()]/g, '').split(',').includes(String(f[k])))
        else filtros.push((f) => f[k] !== v)
        return q
      },
      order: (col, o) => (orden.push({ col, asc: o?.ascending !== false }), q),
      limit: (n) => ((limite = n), q),
      range: (a, b) => ((rango = [a, b]), q),
      maybeSingle: () => ((unico = 'maybe'), Promise.resolve(ejecutar())),
      single: () => ((unico = 'single'), Promise.resolve(ejecutar())),
      then: (res, rej) => Promise.resolve(ejecutar()).then(res, rej),
    }
    return q
  }

  return { sb: { from }, datos, registro }
}
