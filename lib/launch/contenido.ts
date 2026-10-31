import type { SupabaseClient } from '@supabase/supabase-js'
import { piezasDePlantilla } from './plantilla'

// Contenido del lanzamiento (tabla `launch_content`, 20261031120000): calendario de la nutrición
// multicanal y descargables. Cada pieza va fechada respecto al evento (`dia`), así que «Copiar del
// anterior» trae la misma secuencia al lanzamiento nuevo sin recalcular fechas. Todo va con
// `tenant_id` explícito: el cliente es service-role y RLS no protege.

// 'encuesta' = encuesta del grupo de WhatsApp (pregunta en la 1.ª línea y una opción por línea con «- »).
// 'grabar' = vídeo que graba el equipo en su día a día (texto: guion con el dolor que toca).
// 'winners' = tanda de bienvenidas con flyers de nuevos alumnos.
export const CANALES = [
  'email',
  'whatsapp',
  'encuesta',
  'winners',
  'grabar',
  'stories',
  'reel',
  'post',
  'directo',
  'otro',
] as const
export const ESTADOS = ['pendiente', 'listo', 'publicado'] as const
export type Canal = (typeof CANALES)[number]
export type EstadoContenido = (typeof ESTADOS)[number]

export type PiezaContenido = {
  id: string
  launchId: string
  tipo: 'publicacion' | 'descargable'
  canal: Canal
  dia: number | null
  hora: string | null
  titulo: string
  texto: string | null
  enlace: string | null
  estado: EstadoContenido
}

export type DatosPieza = {
  tipo?: 'publicacion' | 'descargable'
  canal?: string
  dia?: number | null
  hora?: string | null
  titulo?: string
  texto?: string | null
  enlace?: string | null
  estado?: EstadoContenido
}

type Fila = {
  id: string
  launch_id: string
  tipo: 'publicacion' | 'descargable'
  canal: Canal
  dia: number | null
  hora: string | null
  titulo: string
  texto: string | null
  enlace: string | null
  estado: EstadoContenido
}

const PROYECCION = 'id, launch_id, tipo, canal, dia, hora, titulo, texto, enlace, estado'

const aPieza = (r: Fila): PiezaContenido => ({
  id: r.id,
  launchId: r.launch_id,
  tipo: r.tipo,
  canal: r.canal,
  dia: r.dia,
  hora: r.hora,
  titulo: r.titulo,
  texto: r.texto,
  enlace: r.enlace,
  estado: r.estado,
})

/** Normaliza y valida lo que llega del formulario. Lanza con un mensaje legible si algo no cuadra. */
export function limpiarPieza(d: DatosPieza, parcial: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const txt = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  if (d.tipo !== undefined) {
    if (d.tipo !== 'publicacion' && d.tipo !== 'descargable') throw new Error('Tipo no válido')
    out.tipo = d.tipo
  }
  if (d.canal !== undefined) {
    if (!(CANALES as readonly string[]).includes(d.canal)) throw new Error('Canal no válido')
    out.canal = d.canal
  }
  if (d.dia !== undefined) {
    if (d.dia !== null && (!Number.isInteger(d.dia) || Math.abs(d.dia) > 60))
      throw new Error('El día debe ser un número entre -60 y 60')
    out.dia = d.dia
  }
  if (d.hora !== undefined) {
    const h = txt(d.hora)
    if (h && !/^\d{1,2}:\d{2}$/.test(h)) throw new Error('Hora en formato HH:MM')
    out.hora = h
  }
  if (d.titulo !== undefined || !parcial) {
    const t = txt(d.titulo)
    if (!t) throw new Error('Falta el título')
    out.titulo = t.slice(0, 200)
  }
  if (d.texto !== undefined) out.texto = txt(d.texto)
  if (d.enlace !== undefined) {
    const e = txt(d.enlace)
    if (e && !/^https?:\/\//i.test(e)) throw new Error('El enlace debe empezar por http(s)://')
    out.enlace = e
  }
  if (d.estado !== undefined) {
    if (!(ESTADOS as readonly string[]).includes(d.estado)) throw new Error('Estado no válido')
    out.estado = d.estado
  }
  return out
}

/** Fecha real de una pieza: día del evento + `dia`. Null si no tiene día (descargables). */
export function fechaDePieza(fechaEvento: string, dia: number | null): string | null {
  if (dia == null) return null
  const d = new Date(`${fechaEvento}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + dia)
  return d.toISOString().slice(0, 10)
}

export async function listarContenido(
  sb: SupabaseClient,
  tenantId: string,
  launchId: string
): Promise<PiezaContenido[]> {
  const { data, error } = await sb
    .from('launch_content')
    .select(PROYECCION)
    .eq('tenant_id', tenantId)
    .eq('launch_id', launchId)
    .order('tipo', { ascending: false })
    .order('dia', { ascending: true, nullsFirst: false })
    .order('hora', { ascending: true, nullsFirst: false })
    .limit(500)
  if (error) throw new Error(`No se pudo leer el contenido: ${error.message}`)
  return ((data ?? []) as Fila[]).map(aPieza)
}

async function lanzamientoDeLaSubcuenta(sb: SupabaseClient, tenantId: string, launchId: string) {
  const { data } = await sb.from('launches').select('id').eq('tenant_id', tenantId).eq('id', launchId).maybeSingle()
  if (!data) throw new Error('Lanzamiento no encontrado')
}

export async function crearPieza(
  sb: SupabaseClient,
  tenantId: string,
  launchId: string,
  d: DatosPieza,
  userId: string
): Promise<string> {
  const v = limpiarPieza(d, false)
  await lanzamientoDeLaSubcuenta(sb, tenantId, launchId)
  const { data, error } = await sb
    .from('launch_content')
    .insert({ ...v, tenant_id: tenantId, launch_id: launchId, created_by: userId })
    .select('id')
    .single()
  if (error || !data) throw new Error(`No se pudo crear la pieza: ${error?.message ?? 'sin respuesta'}`)
  return (data as { id: string }).id
}

export async function editarPieza(sb: SupabaseClient, tenantId: string, id: string, d: DatosPieza): Promise<void> {
  const v = limpiarPieza(d, true)
  if (!Object.keys(v).length) return
  const { error } = await sb
    .from('launch_content')
    .update({ ...v, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', id)
  if (error) throw new Error(`No se pudo editar la pieza: ${error.message}`)
}

export async function borrarPieza(sb: SupabaseClient, tenantId: string, id: string): Promise<void> {
  const { error } = await sb.from('launch_content').delete().eq('tenant_id', tenantId).eq('id', id)
  if (error) throw new Error(`No se pudo borrar la pieza: ${error.message}`)
}

/** Copia la secuencia de otro lanzamiento (mismos días relativos), todo en estado pendiente. */
export async function copiarContenido(
  sb: SupabaseClient,
  tenantId: string,
  origen: string,
  destino: string,
  userId: string
): Promise<number> {
  if (origen === destino) throw new Error('Elige otro lanzamiento')
  await Promise.all([lanzamientoDeLaSubcuenta(sb, tenantId, origen), lanzamientoDeLaSubcuenta(sb, tenantId, destino)])
  const piezas = await listarContenido(sb, tenantId, origen)
  if (!piezas.length) return 0
  const filas = piezas.map((p) => ({
    tenant_id: tenantId,
    launch_id: destino,
    tipo: p.tipo,
    canal: p.canal,
    dia: p.dia,
    hora: p.hora,
    titulo: p.titulo,
    texto: p.texto,
    enlace: p.enlace,
    estado: 'pendiente',
    created_by: userId,
  }))
  const { error } = await sb.from('launch_content').insert(filas)
  if (error) throw new Error(`No se pudo copiar el contenido: ${error.message}`)
  return filas.length
}

/** Aplica la plantilla estándar al lanzamiento (todo en pendiente). Devuelve cuántas piezas añadió. */
export async function aplicarPlantilla(
  sb: SupabaseClient,
  tenantId: string,
  launchId: string,
  userId: string
): Promise<number> {
  await lanzamientoDeLaSubcuenta(sb, tenantId, launchId)
  const filas = piezasDePlantilla().map((d) => ({
    ...limpiarPieza(d, false),
    tenant_id: tenantId,
    launch_id: launchId,
    created_by: userId,
  }))
  const { error } = await sb.from('launch_content').insert(filas)
  if (error) throw new Error(`No se pudo aplicar la plantilla: ${error.message}`)
  return filas.length
}
