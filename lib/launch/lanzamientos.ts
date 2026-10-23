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

export type Lanzamiento = {
  id: string
  slug: string
  label: string
  /** Día del evento, YYYY-MM-DD. */
  fecha: string
  abierto: boolean
  abiertoAt: string | null
}

type Fila = {
  id: string
  slug: string
  label: string
  fecha: string
  opened_at: string | null
}

const PROYECCION = 'id, slug, label, fecha, opened_at'

function aLanzamiento(f: Fila): Lanzamiento {
  return {
    id: f.id,
    slug: f.slug,
    label: f.label,
    fecha: f.fecha,
    abierto: f.opened_at != null,
    abiertoAt: f.opened_at ? new Date(f.opened_at).toISOString() : null,
  }
}

/** Todos los lanzamientos de la subcuenta (abiertos y programados), del más reciente al más antiguo. */
export async function calendario(sb: SupabaseClient, tenantId: string): Promise<Lanzamiento[]> {
  const { data, error } = await sb
    .from('launches')
    .select(PROYECCION)
    .eq('tenant_id', tenantId)
    .order('fecha', { ascending: false })
  if (error) throw new Error(`No se pudo leer el calendario de lanzamientos: ${error.message}`)
  return ((data ?? []) as Fila[]).map(aLanzamiento)
}

/** Lanzamientos abiertos de la subcuenta, el activo primero. */
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

/** El siguiente programado después del activo, o null si no queda ninguno en el calendario. */
export async function siguienteLanzamiento(sb: SupabaseClient, tenantId: string): Promise<Lanzamiento | null> {
  const todos = await calendario(sb, tenantId)
  const activo = todos.find((l) => l.abierto)
  const programados = todos.filter((l) => !l.abierto && (!activo || l.fecha > activo.fecha))
  return programados[programados.length - 1] ?? null
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
  anterior: Lanzamiento
  nuevo: Lanzamiento
  /** Apuntados al anterior después de su evento, ahora en el nuevo. */
  movidos: number
}

/**
 * Abre el siguiente lanzamiento del calendario de la subcuenta.
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
  const abiertos = await lanzamientosAbiertos(sb, tenantId)
  const anterior = abiertos[0]
  if (!anterior) throw new Error('No hay ningún lanzamiento abierto en esta subcuenta')

  // El candidato se lee solo para validar `esperado` y para distinguir "no quedan programados" de
  // "alguien lo acaba de abrir". El claim de verdad es el UPDATE de abajo.
  const programados = await sb
    .from('launches')
    .select(PROYECCION)
    .eq('tenant_id', tenantId)
    .is('opened_at', null)
    .gt('fecha', anterior.fecha)
    .order('fecha', { ascending: true })
    .limit(1)
  if (programados.error) throw new Error(`No se pudo leer el calendario: ${programados.error.message}`)
  const candidato = (programados.data as Fila[] | null)?.[0]
  if (!candidato) throw new Error('No quedan lanzamientos programados en el calendario')
  if (esperado && esperado !== candidato.id) {
    throw new Error(`El siguiente lanzamiento ya no es el que veías (${esperado}). Recarga la página.`)
  }

  const ahora = new Date().toISOString()
  const claim = await sb
    .from('launches')
    .update({ opened_at: ahora, opened_by: actorId, movidos: 0 })
    .eq('tenant_id', tenantId)
    .eq('id', candidato.id)
    .is('opened_at', null)
    .select(PROYECCION)
  if (claim.error) throw new Error(`No se pudo abrir el lanzamiento: ${claim.error.message}`)
  const nuevo = (claim.data as Fila[] | null)?.[0]
  if (!nuevo) {
    throw new Error(`El siguiente lanzamiento ya no es el que veías (${candidato.slug}). Recarga la página.`)
  }

  const movidos = await moverApuntados(sb, tenantId, anterior, nuevo.id)
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

/**
 * Añade una fecha al calendario de la subcuenta (YYYY-MM-DD). El slug y la etiqueta salen de la
 * fecha; la fecha debe ser posterior a la del lanzamiento activo.
 */
export async function programarLanzamiento(sb: SupabaseClient, tenantId: string, fecha: string): Promise<Lanzamiento> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || Number.isNaN(Date.parse(`${fecha}T12:00:00Z`))) {
    throw new Error('Fecha no válida')
  }
  const activo = await lanzamientoActivo(sb, tenantId)
  if (activo && fecha <= activo.fecha) throw new Error('La fecha tiene que ser posterior al lanzamiento activo')

  const d = new Date(`${fecha}T12:00:00Z`)
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic']
  const mes = meses[d.getUTCMonth()]
  const dia = d.getUTCDate()
  const slug = `lanzamiento-${dia}-${mes}-${d.getUTCFullYear()}`
  const label = `Lanzamiento ${dia} ${mes[0].toUpperCase()}${mes.slice(1)} ${d.getUTCFullYear()}`

  const { data, error } = await sb
    .from('launches')
    .insert({ tenant_id: tenantId, slug, label, fecha })
    .select(PROYECCION)
  if (error) {
    // La unique (tenant_id, slug) y la (tenant_id, fecha) dicen lo mismo en la práctica: ya está.
    if (error.code === '23505') throw new Error('Esa fecha ya está en el calendario')
    throw new Error(`No se pudo programar el lanzamiento: ${error.message}`)
  }
  const fila = (data as Fila[] | null)?.[0]
  if (!fila) throw new Error('Esa fecha ya está en el calendario')
  return aLanzamiento(fila)
}
