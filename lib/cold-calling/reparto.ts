import type { SupabaseClient } from '@supabase/supabase-js'
import { qualityScore, resolveFields, type Qualification } from '@/lib/launch/calidad'
import { leerConversiones } from '@/lib/launch/conversiones'
import { leerPaginado } from '@/lib/launch/filas'
import type { Lanzamiento } from '@/lib/launch/lanzamientos'
import type { AjustesColdCalling } from './config'
import { ErrorColdCalling } from './policy'

// REPARTO DE LEADS. La "bolsa" de un lanzamiento son sus apuntados con teléfono que nadie tiene aún
// en su lista y que no han agendado ni comprado ya. Se reparte por tandas, los de mejor nota
// primero, y un mismo lead nunca acaba en dos listas: lo impide el índice único
// (launch_id, contact_id) y la inserción con ON CONFLICT DO NOTHING, así que dos personas pidiendo
// a la vez no necesitan un candado — la segunda simplemente recibe los siguientes.

export type Candidato = {
  contactId: string
  email: string | null
  phone: string | null
  quality: number | null
  /** Cuándo se apuntó al lanzamiento. */
  joinedAt: string
}

/** Últimos 9 dígitos: el número nacional, para detectar al mismo teléfono con y sin prefijo. */
export const tel9 = (phone: string | null | undefined): string => (phone ?? '').replace(/\D/g, '').slice(-9)

/** Mejor nota primero; sin nota, al final; a igualdad, el más reciente (está más caliente). */
export function ordenarBolsa(candidatos: Candidato[]): Candidato[] {
  return [...candidatos].sort(
    (a, b) =>
      (b.quality ?? -1) - (a.quality ?? -1) ||
      Date.parse(b.joinedAt) - Date.parse(a.joinedAt) ||
      (a.contactId < b.contactId ? -1 : 1)
  )
}

/**
 * Quita a la misma persona repetida (dos contactos con el mismo email o el mismo teléfono): se
 * queda el primero de la lista ya ordenada y no se llama dos veces a nadie.
 */
export function sinRepetidos<T extends { email: string | null; phone: string | null }>(
  ordenados: T[],
  max: number
): T[] {
  const emails = new Set<string>()
  const telefonos = new Set<string>()
  const out: T[] = []
  for (const c of ordenados) {
    if (out.length >= max) break
    const email = (c.email ?? '').trim().toLowerCase()
    const tel = tel9(c.phone)
    if ((email && emails.has(email)) || (tel.length >= 7 && telefonos.has(tel))) continue
    if (email) emails.add(email)
    if (tel.length >= 7) telefonos.add(tel)
    out.push(c)
  }
  return out
}

const MAX_BOLSA = 10000
type Pagina<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>
type FilaApuntado = {
  id: string
  created_at: string
  contact_id: string
  contacts: { email: string | null; phone: string | null; qualification: Record<string, unknown> | null } | null
}

/** Candidatos del lanzamiento, ya ordenados y sin repetidos. */
export async function leerBolsa(sb: SupabaseClient, tenantId: string, launch: Lanzamiento): Promise<Candidato[]> {
  const [apuntados, asignados] = await Promise.all([
    leerPaginado<FilaApuntado>(
      (a, b) =>
        sb
          .from('contact_launches')
          .select('id, created_at, contact_id, contacts!inner(email, phone, qualification)')
          .eq('tenant_id', tenantId)
          .eq('launch_id', launch.id)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(a, b) as unknown as Pagina<FilaApuntado>,
      { max: MAX_BOLSA }
    ),
    leerPaginado<{ id: string; contact_id: string }>(
      (a, b) =>
        sb
          .from('cold_calling_assignments')
          .select('id, contact_id')
          .eq('tenant_id', tenantId)
          .eq('launch_id', launch.id)
          .order('id', { ascending: true })
          .range(a, b) as unknown as Pagina<{ id: string; contact_id: string }>,
      { max: MAX_BOLSA * 2 }
    ),
  ])
  const yaAsignados = new Set(asignados.filas.map((f) => f.contact_id))
  const libres = apuntados.filas.filter((f) => !yaAsignados.has(f.contact_id) && tel9(f.contacts?.phone).length >= 7)
  if (libres.length === 0) return []

  // Quien ya ha agendado o comprado desde que se abrió el lanzamiento no necesita la llamada.
  const conv = await leerConversiones(
    sb,
    tenantId,
    libres.map((f) => f.contact_id),
    launch.abiertoAt
  )
  const candidatos: Candidato[] = libres
    .filter((f) => !conv.conCita.has(f.contact_id) && !conv.conVenta.has(f.contact_id))
    .map((f) => ({
      contactId: f.contact_id,
      email: f.contacts?.email ?? null,
      phone: f.contacts?.phone ?? null,
      quality: qualityScore(resolveFields((f.contacts?.qualification ?? null) as Qualification | null)),
      joinedAt: f.created_at,
    }))
  return sinRepetidos(ordenarBolsa(candidatos), Number.POSITIVE_INFINITY)
}

/**
 * Entrega una tanda de leads a una cold caller. Solo del lanzamiento ABIERTO (no se reparte un
 * histórico). Ella puede pedir cuando le quedan pocos por llamar; un gestor puede forzarlo y elegir
 * la cantidad.
 */
export async function pedirMas(
  sb: SupabaseClient,
  tenantId: string,
  e: {
    launch: Lanzamiento
    callerId: string
    actorId: string
    ajustes: AjustesColdCalling
    forzar?: boolean
    cantidad?: number
  }
): Promise<{ asignados: number; quedanEnBolsa: number }> {
  if (!e.launch.abierto) {
    throw new ErrorColdCalling(`Solo se reparten leads de un lanzamiento abierto (${e.launch.label} no lo está)`)
  }
  const cantidad = Math.max(1, Math.min(Math.trunc(e.cantidad ?? e.ajustes.tanda), 200))

  if (!e.forzar) {
    const { count, error } = await sb
      .from('cold_calling_assignments')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('launch_id', e.launch.id)
      .eq('caller_id', e.callerId)
      .eq('status', 'pendiente')
    if (error) throw new Error(`No se pudo contar los leads pendientes: ${error.message}`)
    if ((count ?? 0) > e.ajustes.pedirMasSiQuedan) {
      throw new ErrorColdCalling(
        `Aún te quedan ${count} leads por llamar. Podrás pedir más cuando te queden ${e.ajustes.pedirMasSiQuedan} o menos.`
      )
    }
  }

  const bolsa = await leerBolsa(sb, tenantId, e.launch)
  let asignados = 0
  let cursor = 0
  // Si otra persona se lleva parte de los candidatos entre la lectura y la inserción, esas filas no
  // vuelven (ON CONFLICT DO NOTHING) y se completa con los siguientes de la bolsa.
  while (asignados < cantidad && cursor < bolsa.length) {
    const lote = bolsa.slice(cursor, cursor + (cantidad - asignados))
    cursor += lote.length
    const { data, error } = await sb
      .from('cold_calling_assignments')
      .upsert(
        lote.map((c) => ({
          tenant_id: tenantId,
          launch_id: e.launch.id,
          contact_id: c.contactId,
          caller_id: e.callerId,
          quality: c.quality,
        })),
        { onConflict: 'launch_id,contact_id', ignoreDuplicates: true }
      )
      .select('id, contact_id')
    if (error) throw new Error(`No se pudieron asignar los leads: ${error.message}`)
    const insertadas = (data ?? []) as { id: string; contact_id: string }[]
    if (insertadas.length === 0) continue
    asignados += insertadas.length
    const { error: errEv } = await sb.from('cold_calling_events').insert(
      insertadas.map((a) => ({
        tenant_id: tenantId,
        assignment_id: a.id,
        launch_id: e.launch.id,
        contact_id: a.contact_id,
        caller_id: e.callerId,
        actor_id: e.actorId,
        tipo: 'asignado',
        status: 'pendiente',
      }))
    )
    // La asignación ya es válida; el evento de reparto es informativo y su fallo no la deshace.
    if (errEv) console.error('[cold-calling] no se pudo registrar el reparto en el historial:', errEv.message)
  }
  return { asignados, quedanEnBolsa: Math.max(0, bolsa.length - cursor) }
}
