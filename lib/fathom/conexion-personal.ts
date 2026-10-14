// CONEXIÓN PERSONAL DE FATHOM: cada closer conecta SU cuenta y la app trae SUS reuniones.
//
// La ingesta es la canónica (`procesarMeetingFathom`): empareja por contacto y hora, y lo dudoso va a la
// cola de revisión; aquí solo cambia DE DÓNDE salen las reuniones (la clave de cada closer en vez de la
// única de la subcuenta). Idempotente: una reunión que ya entró por otra vía (webhook, histórico o la
// clave de otro closer) se detecta como `ya_importadas`/`ya_en_revision` y no se duplica.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret, encryptSecret, getConfigEncryptionKeyFingerprint } from '@/lib/config'
import { procesarMeetingFathom } from '@/lib/fathom/ingesta'
import { fetchMeetingsPage, validarClaveFathom } from '@/lib/fathom/meetings'

export type ConexionFathom = {
  id: string
  tenant_id: string
  user_id: string
  api_key: string
  status: 'conectada' | 'error'
  last_sync_at: string | null
  last_error: string | null
  meetings_seen: number
}

export type EstadoConexionFathom = {
  conectada: boolean
  status: 'conectada' | 'error' | null
  ultimaSync: string | null
  ultimoError: string | null
  reunionesVistas: number
}

export const SIN_CONEXION: EstadoConexionFathom = {
  conectada: false,
  status: null,
  ultimaSync: null,
  ultimoError: null,
  reunionesVistas: 0,
}

const COLUMNAS = 'id,tenant_id,user_id,api_key,status,last_sync_at,last_error,meetings_seen'

/** La tabla aún no existe (migración sin aplicar): se trata como «sin conexiones», no como una avería. */
export function esTablaInexistente(mensaje: string | null | undefined): boolean {
  return /user_fathom_connections/.test(mensaje || '') && /(does not exist|schema cache|not find)/i.test(mensaje || '')
}

export function estadoPublico(c: ConexionFathom | null): EstadoConexionFathom {
  if (!c) return SIN_CONEXION
  return {
    conectada: c.status === 'conectada',
    status: c.status,
    ultimaSync: c.last_sync_at,
    ultimoError: c.last_error,
    reunionesVistas: c.meetings_seen,
  }
}

export async function leerConexionPersonal(
  sb: SupabaseClient,
  tenantId: string,
  userId: string
): Promise<ConexionFathom | null> {
  const { data, error } = await sb
    .from('user_fathom_connections')
    .select(COLUMNAS)
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ConexionFathom | null) ?? null
}

export async function guardarConexionPersonal(
  sb: SupabaseClient,
  tenantId: string,
  userId: string,
  apiKey: string
): Promise<{ ok: true } | { ok: false; error: string; codigo: 'clave_invalida' | 'error' | 'red' | 'vacia' }> {
  const clave = apiKey.trim()
  if (!clave) return { ok: false, error: 'Pega tu clave de API de Fathom', codigo: 'vacia' }
  const valida = await validarClaveFathom(clave)
  if (!valida.ok) {
    const error =
      valida.motivo === 'clave_invalida'
        ? 'Fathom no reconoce esa clave. Cópiala de Fathom › Settings › API Access.'
        : valida.motivo === 'red'
          ? 'No se pudo contactar con Fathom. Inténtalo de nuevo en un minuto.'
          : valida.detalle || 'Fathom devolvió un error'
    return { ok: false, error, codigo: valida.motivo }
  }
  const { error } = await sb.from('user_fathom_connections').upsert(
    {
      tenant_id: tenantId,
      user_id: userId,
      api_key: encryptSecret(clave),
      key_fingerprint: getConfigEncryptionKeyFingerprint(),
      status: 'conectada',
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,user_id' }
  )
  if (error) return { ok: false, error: error.message, codigo: 'error' }
  return { ok: true }
}

export async function borrarConexionPersonal(sb: SupabaseClient, tenantId: string, userId: string): Promise<void> {
  const { error } = await sb.from('user_fathom_connections').delete().eq('tenant_id', tenantId).eq('user_id', userId)
  if (error) throw new Error(error.message)
}

export type ResumenSyncFathom = {
  vistas: number
  nuevas: number
  enRevision: number
  omitidas: number
  cortado: boolean
}

/**
 * Trae las reuniones MÁS RECIENTES de una conexión y las pasa por la ingesta canónica. Pocas páginas y
 * pequeñas a propósito: cada pasada del cron solo necesita lo nuevo, y el histórico completo sigue en
 * el botón de Integraciones. Un fallo de la clave deja la conexión en `error` con su motivo (nunca
 * silencioso) y NO borra nada.
 */
export async function sincronizarConexionPersonal(
  sb: SupabaseClient,
  conexion: ConexionFathom,
  opts: { paginas?: number; porPagina?: number; deadlineMs?: number } = {}
): Promise<ResumenSyncFathom> {
  const resumen: ResumenSyncFathom = { vistas: 0, nuevas: 0, enRevision: 0, omitidas: 0, cortado: false }
  let clave: string
  try {
    clave = decryptSecret(conexion.api_key)
  } catch {
    await marcar(sb, conexion, 'error', 'La clave guardada no se puede descifrar: vuelve a pegarla.')
    return resumen
  }
  const paginas = Math.max(1, opts.paginas ?? 1)
  let cursor = ''
  try {
    for (let p = 0; p < paginas; p++) {
      if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
        resumen.cortado = true
        break
      }
      const pagina = await fetchMeetingsPage(clave, cursor, { limit: opts.porPagina ?? 25 })
      for (const meeting of pagina.items) {
        if (opts.deadlineMs && Date.now() > opts.deadlineMs) {
          resumen.cortado = true
          break
        }
        resumen.vistas++
        const r = await procesarMeetingFathom(sb, conexion.tenant_id, meeting)
        if (r.kind === 'emparejadas') resumen.nuevas++
        else if (r.kind === 'a_revision_ambiguas' || r.kind === 'a_revision_sin_candidatos') resumen.enRevision++
        else resumen.omitidas++
      }
      if (resumen.cortado || !pagina.nextCursor) break
      cursor = pagina.nextCursor
    }
  } catch (e) {
    await marcar(sb, conexion, 'error', e instanceof Error ? e.message.slice(0, 300) : 'Error al leer Fathom')
    return resumen
  }
  await sb
    .from('user_fathom_connections')
    .update({
      status: 'conectada',
      last_error: null,
      last_sync_at: new Date().toISOString(),
      meetings_seen: conexion.meetings_seen + resumen.vistas,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conexion.id)
  return resumen
}

async function marcar(sb: SupabaseClient, c: ConexionFathom, status: 'conectada' | 'error', error: string) {
  await sb
    .from('user_fathom_connections')
    .update({ status, last_error: error, last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', c.id)
}
