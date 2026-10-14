// AJUSTES GLOBALES DE LA PLATAFORMA.
//
// Lo que no pertenece a ninguna subcuenta (el cliente OAuth de Google, el secreto del webhook de
// onboarding…) vivía solo en variables de entorno de Vercel. Aquí lo gestiona un super admin desde la
// app. Orden de resolución: valor guardado aquí → variable de entorno (respaldo, para no romper lo que
// ya funciona). Los secretos se cifran con la misma llave que `integration_settings`.
//
// Solo servidor. Nunca devuelve un secreto a una pantalla: el estado público dice «configurado»,
// de dónde viene y la huella; el valor solo existe en memoria del servidor.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret, encryptSecret, getConfigEncryptionKeyFingerprint } from '@/lib/config'

export type PlatformSettingDef = {
  key: string
  label: string
  descripcion: string
  /** Cifrado en reposo y jamás mostrado. `false` = identificador visible (p. ej. un Client ID). */
  secret: boolean
  /** Validación de formato; devuelve un mensaje de error o `null`. */
  validar?: (v: string) => string | null
}

export const PLATFORM_SETTINGS: PlatformSettingDef[] = [
  {
    key: 'GOOGLE_OAUTH_CLIENT_ID',
    label: 'Google · Client ID',
    descripcion:
      'Cliente OAuth de Google de la plataforma (Google Cloud › APIs y servicios › Credenciales). Sirve a GA4, Calendar y YouTube de todas las subcuentas.',
    secret: false,
    validar: (v) =>
      /^[\w-]+\.apps\.googleusercontent\.com$/.test(v) ? null : 'Debe acabar en .apps.googleusercontent.com',
  },
  {
    key: 'GOOGLE_OAUTH_CLIENT_SECRET',
    label: 'Google · Client Secret',
    descripcion: 'Secreto del mismo cliente OAuth. Se guarda cifrado y no se vuelve a mostrar.',
    secret: true,
    validar: (v) => (v.length >= 10 ? null : 'Parece demasiado corto'),
  },
  {
    key: 'ONBOARDING_INBOUND_SECRET',
    label: 'Webhook de onboarding · secreto',
    descripcion:
      'Secreto compartido (cabecera x-ghl-secret o ?secret=) con el que GHL llama al webhook de onboarding del alumno. Sin él, el webhook rechaza todo con 401.',
    secret: true,
    validar: (v) => (v.length >= 16 ? null : 'Usa al menos 16 caracteres'),
  },
]

const POR_CLAVE = new Map(PLATFORM_SETTINGS.map((d) => [d.key, d]))

export function definicionDeAjuste(key: string): PlatformSettingDef | null {
  return POR_CLAVE.get(key) ?? null
}

function servicio(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

type Fila = { key: string; value: string; is_secret: boolean; key_fingerprint: string | null; updated_at: string }
let cache: { filas: Map<string, Fila>; hasta: number } | null = null
const TTL_MS = 30_000

async function leerFilas(force = false): Promise<Map<string, Fila> | null> {
  if (!force && cache && cache.hasta > Date.now()) return cache.filas
  const { data, error } = await servicio()
    .from('platform_settings')
    .select('key,value,is_secret,key_fingerprint,updated_at')
  // Sin tabla (migración pendiente) o sin lectura: se cae al entorno, nunca se rompe lo que funciona.
  if (error) return null
  const filas = new Map<string, Fila>((data ?? []).map((f) => [f.key as string, f as Fila]))
  cache = { filas, hasta: Date.now() + TTL_MS }
  return filas
}

export function invalidarAjustesPlataforma(): void {
  cache = null
}

/** Valor efectivo de un ajuste global: guardado → variable de entorno → `null`. */
export async function getPlatformSetting(key: string): Promise<string | null> {
  const def = definicionDeAjuste(key)
  if (def) {
    const filas = await leerFilas()
    const fila = filas?.get(key)
    if (fila?.value) {
      try {
        const v = (def.secret ? decryptSecret(fila.value) : fila.value).trim()
        if (v) return v
      } catch {
        // Cifrado con otra llave: se cae al entorno y el panel lo señala como «no descifrable».
      }
    }
  }
  return process.env[key]?.trim() || null
}

export type EstadoAjuste = {
  key: string
  label: string
  descripcion: string
  secret: boolean
  configurado: boolean
  /** De dónde sale el valor efectivo. */
  origen: 'plataforma' | 'entorno' | 'ninguno'
  /** Solo para ajustes NO secretos. */
  valor: string | null
  actualizado: string | null
  /** El valor guardado no se puede descifrar con la llave actual. */
  indescifrable: boolean
}

export async function estadoAjustesPlataforma(): Promise<{ ajustes: EstadoAjuste[]; tablaDisponible: boolean }> {
  const filas = await leerFilas(true)
  const ajustes: EstadoAjuste[] = []
  for (const def of PLATFORM_SETTINGS) {
    const fila = filas?.get(def.key)
    let indescifrable = false
    let efectivo: string | null = null
    let origen: EstadoAjuste['origen'] = 'ninguno'
    if (fila?.value) {
      try {
        efectivo = (def.secret ? decryptSecret(fila.value) : fila.value).trim() || null
        if (efectivo) origen = 'plataforma'
      } catch {
        indescifrable = true
      }
    }
    if (!efectivo && process.env[def.key]?.trim()) {
      efectivo = process.env[def.key]!.trim()
      origen = 'entorno'
    }
    ajustes.push({
      key: def.key,
      label: def.label,
      descripcion: def.descripcion,
      secret: def.secret,
      configurado: !!efectivo,
      origen,
      valor: !def.secret ? efectivo : null,
      actualizado: fila?.updated_at ?? null,
      indescifrable,
    })
  }
  return { ajustes, tablaDisponible: filas !== null }
}

export async function guardarAjustePlataforma(
  key: string,
  valor: string,
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const def = definicionDeAjuste(key)
  if (!def) return { ok: false, error: 'Ajuste desconocido' }
  const limpio = valor.trim()
  if (!limpio) return { ok: false, error: 'El valor está vacío' }
  const invalido = def.validar?.(limpio)
  if (invalido) return { ok: false, error: invalido }
  const { error } = await servicio()
    .from('platform_settings')
    .upsert(
      {
        key,
        value: def.secret ? encryptSecret(limpio) : limpio,
        is_secret: def.secret,
        key_fingerprint: def.secret ? getConfigEncryptionKeyFingerprint() : null,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    )
  if (error) return { ok: false, error: error.message }
  invalidarAjustesPlataforma()
  return { ok: true }
}

export async function borrarAjustePlataforma(key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!definicionDeAjuste(key)) return { ok: false, error: 'Ajuste desconocido' }
  const { error } = await servicio().from('platform_settings').delete().eq('key', key)
  if (error) return { ok: false, error: error.message }
  invalidarAjustesPlataforma()
  return { ok: true }
}
