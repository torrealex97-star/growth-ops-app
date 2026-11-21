import type { SupabaseClient } from '@supabase/supabase-js'

// Calendario de lanzamientos (tabla `launches`, 20261023100000). Fuente única del lanzamiento ACTIVO
// de cada subcuenta: el webhook de GHL, el panel y el MCP preguntan aquí.
//
// Activo = el abierto con la fecha más reciente. Los programados (opened_at NULL) no existen para el
// resto de la app hasta que alguien pulsa "Abrir siguiente lanzamiento" en el panel; entonces:
//   1. los registros nuevos pasan a guardarse en el nuevo,
//   2. quien se apuntó al anterior DESPUÉS de su evento se mueve al nuevo, porque se apuntó a un
//      directo que ya había pasado y en realidad viene al próximo.
//
// Diferencias con el origen (iawinners): aquí todo va por Supabase con `tenant_id` explícito en cada
// consulta (nunca por un cliente con RLS ajena ni por caché global de proceso — el caché por proceso
// del origen filtraba entre subcuentas), y los módulos de WhatsApp y cold callers del origen aún no
// están portados, así que la apertura solo mueve `contact_launches`.

export type EstadoLanzamiento = 'programado' | 'abierto' | 'cerrado'

export type Lanzamiento = {
  id: string
  slug: string
  label: string
  /** Día del evento, YYYY-MM-DD. */
  fecha: string
  /** programado (aún no recibe leads) → abierto (recibe los leads del webhook) → cerrado (histórico). */
  estado: EstadoLanzamiento
  /** true solo mientras está abierto Y sin cerrar: es el que puede ser el activo. */
  abierto: boolean
  abiertoAt: string | null
  cerradoAt: string | null
}

type Fila = {
  id: string
  slug: string
  label: string
  fecha: string
  opened_at: string | null
  closed_at?: string | null
}

const PROYECCION = 'id, slug, label, fecha, opened_at, closed_at'
// `closed_at` llega con 20261110100000_lanzamientos_cierre.sql. Mientras esa migración no esté
// aplicada en una BD, se lee sin la columna (nadie está cerrado) en vez de tumbar el panel entero.
const PROYECCION_SIN_CIERRE = 'id, slug, label, fecha, opened_at'
const COLUMNA_INEXISTENTE = '42703'
const FALTA_MIGRACION_CIERRE =
  'Cerrar lanzamientos necesita la migración 20261110100000_lanzamientos_cierre.sql, que aún no está aplicada en esta base de datos'

type Respuesta = { data: unknown; error: { code?: string; message: string } | null }

/** Ejecuta una lectura de `launches` y, si la BD aún no tiene `closed_at`, la repite sin esa columna. */
async function leerFilas(consulta: (proyeccion: string) => PromiseLike<Respuesta>): Promise<Respuesta> {
  const r = await consulta(PROYECCION)
  if (r.error?.code === COLUMNA_INEXISTENTE) return consulta(PROYECCION_SIN_CIERRE)
  return r
}

function aLanzamiento(f: Fila): Lanzamiento {
  const estado: EstadoLanzamiento = f.opened_at == null ? 'programado' : f.closed_at != null ? 'cerrado' : 'abierto'
  return {
    id: f.id,
    slug: f.slug,
    label: f.label,
    fecha: f.fecha,
    estado,
    abierto: estado === 'abierto',
    abiertoAt: f.opened_at ? new Date(f.opened_at).toISOString() : null,
    cerradoAt: f.closed_at ? new Date(f.closed_at).toISOString() : null,
  }
}

/** Todos los lanzamientos de la subcuenta (programados, abiertos y cerrados), del más reciente al más antiguo. */
export async function calendario(sb: SupabaseClient, tenantId: string): Promise<Lanzamiento[]> {
  const { data, error } = await leerFilas((cols) =>
    sb.from('launches').select(cols).eq('tenant_id', tenantId).order('fecha', { ascending: false })
  )
  if (error) throw new Error(`No se pudo leer el calendario de lanzamientos: ${error.message}`)
  return ((data ?? []) as Fila[]).map(aLanzamiento)
}

/** Lanzamientos abiertos (sin cerrar) de la subcuenta, el activo primero. */
export async function lanzamientosAbiertos(sb: SupabaseClient, tenantId: string): Promise<Lanzamiento[]> {
  return (await calendario(sb, tenantId)).filter((l) => l.abierto)
}

/**
 * El lanzamiento activo de la subcuenta, o null si no hay ninguno abierto. NULL no es un error: es
 * "todavía no se ha abierto ninguno" y el panel lo dice tal cual — no se inventa un lanzamiento.
 */
export async function lanzamientoActivo(sb: SupabaseClient, tenantId: string): Promise<Lanzamiento | null> {
  const abiertos = await lanzamientosAbiertos(sb, tenantId)
  return abiertos[0] ?? null
}

/** El último que llegó a abrirse (siga abierto o ya cerrado): la referencia de "qué viene después". */
function ultimoAbierto(todos: Lanzamiento[]): Lanzamiento | null {
  return todos.find((l) => l.estado !== 'programado') ?? null
}

/**
 * El siguiente programado: el más próximo posterior al último que se abrió, o —si la subcuenta aún
 * no ha abierto ninguno— el primero del calendario. null si no queda ninguno.
 */
export function siguienteDe(todos: Lanzamiento[]): Lanzamiento | null {
  const ref = ultimoAbierto(todos)
  const programados = todos.filter((l) => l.estado === 'programado' && (!ref || l.fecha > ref.fecha))
  return programados[programados.length - 1] ?? null
}

export async function siguienteLanzamiento(sb: SupabaseClient, tenantId: string): Promise<Lanzamiento | null> {
  return siguienteDe(await calendario(sb, tenantId))
}

/**
 * Inicio de un día en hora de España, como timestamp con offset. El desfase se calcula (verano
 * +02:00, invierno +01:00) para que valga todo el año.
 */
export function inicioDiaMadrid(fecha: string): string {
  const off =
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Madrid', timeZoneName: 'shortOffset' })
      .formatToParts(new Date(`${fecha}T12:00:00Z`))
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+2'
  const h = Number(off.replace('GMT', '') || 0)
  return `${fecha}T00:00:00${h < 0 ? '-' : '+'}${String(Math.abs(h)).padStart(2, '0')}:00`
}

/** Día siguiente a una fecha YYYY-MM-DD. */
export function diaSiguiente(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Nombre legible de un slug ("lanzamiento-28-oct" → "Lanzamiento 28 Oct"). */
export function launchLabel(slug: string | null | undefined): string {
  if (!slug) return '—'
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export type ResultadoApertura = {
  /** El último que estuvo abierto, o null si este es el primer lanzamiento de la subcuenta. */
  anterior: Lanzamiento | null
  nuevo: Lanzamiento
  /** Apuntados al anterior después de su evento, ahora en el nuevo. */
  movidos: number
}

/**
 * Abre el siguiente lanzamiento del calendario de la subcuenta.
 *
 * Vale también para el PRIMERO: si la subcuenta nunca ha abierto ninguno, abre el programado más
 * próximo y no hay apuntados que mover. (Antes exigía que ya hubiera uno abierto, así que una
 * subcuenta nueva no podía arrancar nunca y el webhook descartaba todos los leads.)
 *
 * La APERTURA ES UN CLAIM ATÓMICO: un único `UPDATE … WHERE opened_at IS NULL` con RETURNING. Si dos
 * personas pulsan a la vez, solo una fila vuelve; la segunda ve la respuesta vacía y se le dice que
 * recargue. El movimiento de apuntados va DESPUÉS del claim y es idempotente (excluye los que ya
 * están en el nuevo), así que un corte a mitad se completa repitiendo desde el panel sin duplicar.
 */
export async function abrirSiguienteLanzamiento(
  sb: SupabaseClient,
  tenantId: string,
  actorId: string | null,
  esperado?: string
): Promise<ResultadoApertura> {
  const todos = await calendario(sb, tenantId)
  const anterior = ultimoAbierto(todos)

  // El candidato se lee solo para validar `esperado` y para distinguir "no quedan programados" de
  // "alguien lo acaba de abrir". El claim de verdad es el UPDATE de abajo.
  const candidato = siguienteDe(todos)
  if (!candidato) {
    throw new Error('No quedan lanzamientos programados en el calendario. Programa una fecha primero.')
  }
  if (esperado && esperado !== candidato.id) {
    throw new Error('El siguiente lanzamiento ya no es el que veías. Recarga la página.')
  }

  const ahora = new Date().toISOString()
  const claim = await leerFilas((cols) =>
    sb
      .from('launches')
      .update({ opened_at: ahora, opened_by: actorId, movidos: 0 })
      .eq('tenant_id', tenantId)
      .eq('id', candidato.id)
      .is('opened_at', null)
      .select(cols)
  )
  if (claim.error) throw new Error(`No se pudo abrir el lanzamiento: ${claim.error.message}`)
  const nuevo = (claim.data as Fila[] | null)?.[0]
  if (!nuevo) {
    throw new Error(`Alguien acaba de abrir ${candidato.label}. Recarga la página.`)
  }

  const movidos = anterior ? await moverApuntados(sb, tenantId, anterior, nuevo.id) : 0
  if (movidos !== 0) {
    // El recuento es informativo; si falla, la apertura ya es válida y no se revierte.
    const { error } = await sb.from('launches').update({ movidos }).eq('tenant_id', tenantId).eq('id', nuevo.id)
    if (error) console.warn('[lanzamientos] no se pudo guardar el recuento de movidos:', error.message)
  }

  return { anterior, nuevo: aLanzamiento(nuevo as Fila), movidos }
}

/**
 * Mueve al nuevo lanzamiento a quien se apuntó al anterior a partir del día siguiente a su evento
 * (el corte es en hora de España, no en UTC). Idempotente: quien ya está apuntado al nuevo no se toca.
 */
async function moverApuntados(
  sb: SupabaseClient,
  tenantId: string,
  anterior: Lanzamiento,
  nuevoId: string
): Promise<number> {
  const corte = inicioDiaMadrid(diaSiguiente(anterior.fecha))
  const { data: candidatos, error } = await sb
    .from('contact_launches')
    .select('id, contact_id')
    .eq('tenant_id', tenantId)
    .eq('launch_id', anterior.id)
    .gte('created_at', corte)
  if (error) throw new Error(`No se pudieron leer los apuntados a mover: ${error.message}`)
  const lista = (candidatos ?? []) as { id: string; contact_id: string }[]
  if (lista.length === 0) return 0

  const { data: yaEnNuevo, error: errorYa } = await sb
    .from('contact_launches')
    .select('contact_id')
    .eq('tenant_id', tenantId)
    .eq('launch_id', nuevoId)
    .in(
      'contact_id',
      lista.map((c) => c.contact_id)
    )
  if (errorYa) throw new Error(`No se pudo comprobar los apuntados del nuevo lanzamiento: ${errorYa.message}`)
  const ya = new Set((yaEnNuevo ?? []).map((r) => (r as { contact_id: string }).contact_id))
  const porMover = lista.filter((c) => !ya.has(c.contact_id))
  if (porMover.length === 0) return 0

  // Nota: en el origen esto actualizaba también `contacts.launch_id`; Scalix no copia esa columna
  // (a diferencia de iawinners, no existe). "Por qué lanzamiento entró" se deriva del apuntado más
  // antiguo del contacto en `contact_launches`.
  const { error: errMove } = await sb
    .from('contact_launches')
    .update({ launch_id: nuevoId })
    .eq('tenant_id', tenantId)
    .in(
      'id',
      porMover.map((c) => c.id)
    )
  if (errMove) throw new Error(`No se pudo mover los apuntados al nuevo lanzamiento: ${errMove.message}`)
  return porMover.length
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']
const LARGO_NOMBRE = 80

function fechaValida(fecha: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) && !Number.isNaN(Date.parse(`${fecha}T12:00:00Z`))
}

/** Slug y nombre por defecto a partir del día del evento. */
function derivadosDeFecha(fecha: string): { slug: string; label: string } {
  const d = new Date(`${fecha}T12:00:00Z`)
  const mes = MESES[d.getUTCMonth()]
  const dia = d.getUTCDate()
  return {
    slug: `lanzamiento-${dia}-${mes}-${d.getUTCFullYear()}`,
    label: `Lanzamiento ${dia} ${mes[0].toUpperCase()}${mes.slice(1)} ${d.getUTCFullYear()}`,
  }
}

function limpiarNombre(nombre: string | null | undefined): string | null {
  const limpio = (nombre ?? '').replace(/\s+/g, ' ').trim().slice(0, LARGO_NOMBRE)
  return limpio || null
}

/**
 * Añade una fecha al calendario de la subcuenta (YYYY-MM-DD). El slug sale de la fecha; el nombre es
 * el que se indique o, si se deja vacío, uno derivado de la fecha. Debe ser posterior al activo.
 */
export async function programarLanzamiento(
  sb: SupabaseClient,
  tenantId: string,
  fecha: string,
  nombre?: string | null
): Promise<Lanzamiento> {
  if (!fechaValida(fecha)) throw new Error('Fecha no válida')
  const activo = await lanzamientoActivo(sb, tenantId)
  if (activo && fecha <= activo.fecha) throw new Error('La fecha tiene que ser posterior al lanzamiento activo')

  const { slug, label } = derivadosDeFecha(fecha)
  const { data, error } = await leerFilas((cols) =>
    sb
      .from('launches')
      .insert({ tenant_id: tenantId, slug, label: limpiarNombre(nombre) ?? label, fecha })
      .select(cols)
  )
  if (error) {
    // La unique (tenant_id, slug) y la (tenant_id, fecha) dicen lo mismo en la práctica: ya está.
    if (error.code === '23505') throw new Error('Esa fecha ya está en el calendario')
    throw new Error(`No se pudo programar el lanzamiento: ${error.message}`)
  }
  const fila = (data as Fila[] | null)?.[0]
  if (!fila) throw new Error('Esa fecha ya está en el calendario')
  return aLanzamiento(fila)
}

async function leerUno(sb: SupabaseClient, tenantId: string, id: string): Promise<Lanzamiento | null> {
  const { data, error } = await leerFilas((cols) =>
    sb.from('launches').select(cols).eq('tenant_id', tenantId).eq('id', id).limit(1)
  )
  if (error) throw new Error(`No se pudo leer el lanzamiento: ${error.message}`)
  const fila = (data as Fila[] | null)?.[0]
  return fila ? aLanzamiento(fila) : null
}

/** Un lanzamiento de la subcuenta por id, o null si no existe en ella. */
export async function lanzamientoPorId(sb: SupabaseClient, tenantId: string, id: string): Promise<Lanzamiento | null> {
  return leerUno(sb, tenantId, id)
}

/**
 * Cambia el nombre (siempre) o la fecha (solo mientras está programado: una vez abierto, la fecha
 * decide a quién se mueve al abrir el siguiente y no se toca).
 */
export async function editarLanzamiento(
  sb: SupabaseClient,
  tenantId: string,
  id: string,
  cambios: { label?: string | null; fecha?: string | null }
): Promise<Lanzamiento> {
  const actual = await leerUno(sb, tenantId, id)
  if (!actual) throw new Error('Lanzamiento no encontrado')

  const set: Record<string, string> = {}
  if (cambios.label !== undefined) {
    const nombre = limpiarNombre(cambios.label)
    if (!nombre) throw new Error('El nombre no puede quedar vacío')
    set.label = nombre
  }
  if (cambios.fecha != null && cambios.fecha !== actual.fecha) {
    if (actual.estado !== 'programado') {
      throw new Error('La fecha no se puede cambiar: el lanzamiento ya está abierto')
    }
    if (!fechaValida(cambios.fecha)) throw new Error('Fecha no válida')
    const ref = ultimoAbierto(await calendario(sb, tenantId))
    if (ref && cambios.fecha <= ref.fecha) {
      throw new Error(`La fecha tiene que ser posterior a ${ref.label}`)
    }
    set.fecha = cambios.fecha
    set.slug = derivadosDeFecha(cambios.fecha).slug
  }
  if (Object.keys(set).length === 0) return actual

  let q = sb.from('launches').update(set).eq('tenant_id', tenantId).eq('id', id)
  // La fecha solo se cambia si SIGUE programado: si alguien lo abrió entre la lectura y este UPDATE,
  // no vuelve fila y se avisa, en vez de mover la fecha de un lanzamiento ya abierto.
  if (set.fecha) q = q.is('opened_at', null)
  const { data, error } = await leerFilas((cols) => q.select(cols))
  if (error) {
    if (error.code === '23505') throw new Error('Esa fecha ya está en el calendario')
    throw new Error(`No se pudo guardar el lanzamiento: ${error.message}`)
  }
  const fila = (data as Fila[] | null)?.[0]
  if (!fila) throw new Error('El lanzamiento ha cambiado mientras lo editabas. Recarga la página.')
  return aLanzamiento(fila)
}

/**
 * Cierra un lanzamiento abierto: deja de ser el activo y pasa a histórico. Sus leads, contenido e
 * informe se conservan. Mientras no se abra otro, el webhook responde "no hay lanzamiento abierto".
 */
export async function cerrarLanzamiento(
  sb: SupabaseClient,
  tenantId: string,
  id: string,
  actorId: string | null = null
): Promise<Lanzamiento> {
  const { data, error } = await sb
    .from('launches')
    .update({ closed_at: new Date().toISOString(), closed_by: actorId })
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .not('opened_at', 'is', null)
    .is('closed_at', null)
    .select(PROYECCION)
  if (error) {
    if (error.code === COLUMNA_INEXISTENTE || error.code === 'PGRST204') throw new Error(FALTA_MIGRACION_CIERRE)
    throw new Error(`No se pudo cerrar el lanzamiento: ${error.message}`)
  }
  const fila = (data as Fila[] | null)?.[0]
  if (!fila) throw new Error('Ese lanzamiento no está abierto (o ya estaba cerrado)')
  return aLanzamiento(fila)
}

/** Quita del calendario una fecha que aún no se ha abierto (y el contenido preparado para ella). */
export async function borrarProgramado(sb: SupabaseClient, tenantId: string, id: string): Promise<void> {
  const { data, error } = await sb
    .from('launches')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .is('opened_at', null)
    .select('id')
  if (error) throw new Error(`No se pudo borrar el lanzamiento: ${error.message}`)
  if (!(data as { id: string }[] | null)?.length) {
    throw new Error('Solo se puede borrar un lanzamiento programado que aún no se ha abierto')
  }
}
