import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSecret, encryptSecret } from '@/lib/config'
import { googleCredentials } from '@/lib/google/oauth'

export type StoredGoogleConnection = {
  id: string
  refresh_token: string
  access_token?: string | null
  access_token_expires_at?: string | null
}

export type GoogleTokenResult = { token: string } | { error: string; revoked: boolean; reauthRequired: boolean }

const EARLY_REFRESH_MS = 5 * 60 * 1000

export async function getValidGoogleAccessToken(
  sb: SupabaseClient,
  connection: StoredGoogleConnection
): Promise<GoogleTokenResult> {
  if (connection.access_token && connection.access_token_expires_at) {
    const expiresAt = Date.parse(connection.access_token_expires_at)
    if (Number.isFinite(expiresAt) && expiresAt - Date.now() > EARLY_REFRESH_MS) {
      try {
        return { token: decryptSecret(connection.access_token) }
      } catch {
        // El refresh token todavía puede permitir reparar el access token tras una rotación.
      }
    }
  }

  const credentials = await googleCredentials()
  if (!credentials) {
    return { error: 'OAuth global de Google no configurado', revoked: false, reauthRequired: false }
  }

  let refreshToken: string
  try {
    refreshToken = decryptSecret(connection.refresh_token)
  } catch {
    await markReauth(sb, connection.id, 'El token ya no se puede descifrar; vuelve a conectar Google.')
    return {
      error: 'La conexión fue cifrada con una clave anterior. Vuelve a conectar Google.',
      revoked: false,
      reauthRequired: true,
    }
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }
  if (!response.ok || !body.access_token) {
    const revoked = body.error === 'invalid_grant'
    const message = body.error_description || body.error || `Google respondió ${response.status}`
    if (revoked) await markReauth(sb, connection.id, message)
    return { error: message, revoked, reauthRequired: revoked }
  }

  const now = new Date()
  const update: Record<string, string | null> = {
    access_token: encryptSecret(body.access_token),
    access_token_expires_at: new Date(now.getTime() + Math.max(60, body.expires_in ?? 3600) * 1000).toISOString(),
    last_refresh_at: now.toISOString(),
    reauth_required_at: null,
    status: 'conectada',
    last_error: null,
  }
  if (body.refresh_token) update.refresh_token = encryptSecret(body.refresh_token)
  const { error } = await sb.from('google_oauth_connections').update(update).eq('id', connection.id)
  if (error) return { error: error.message, revoked: false, reauthRequired: false }
  return { token: body.access_token }
}

async function markReauth(sb: SupabaseClient, id: string, message: string): Promise<void> {
  await sb
    .from('google_oauth_connections')
    .update({
      status: 'revocada',
      last_error: message,
      reauth_required_at: new Date().toISOString(),
      access_token: null,
      access_token_expires_at: null,
    })
    .eq('id', id)
}
