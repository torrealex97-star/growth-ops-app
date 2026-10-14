// Piezas compartidas del flujo OAuth con Google.
import { getPlatformSetting } from '@/lib/platform/settings'
import { isGoogleOAuthClientId } from '@/lib/integrations/oauth-credentials'

/**
 * Ámbitos mínimos por servicio. Los permisos de lectura y publicación de YouTube viven en
 * autorizaciones separadas para que consultar analítica nunca conceda permiso para publicar.
 */
export type GoogleProvider = 'ga4' | 'calendar' | 'youtube' | 'youtube_publish'

export const SCOPES: Record<GoogleProvider, string[]> = {
  ga4: ['openid', 'email', 'https://www.googleapis.com/auth/analytics.readonly'],
  // Calendar empieza deliberadamente en solo lectura. calendarlist.readonly permite que el closer
  // elija su calendario principal y los de conflicto; events.readonly permite conciliarlos. El
  // write-back exigirá una autorización incremental separada cuando exista esa función.
  calendar: [
    'openid',
    'email',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events.readonly',
  ],
  // Consultar el canal y sus analíticas no concede permiso para publicar. La autorización de
  // escritura vive en `youtube_publish` y se solicita solo cuando el usuario activa esa función.
  youtube: [
    'openid',
    'email',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ],
  youtube_publish: ['openid', 'email', 'https://www.googleapis.com/auth/youtube.upload'],
}

/**
 * URI de redirección. Tiene que coincidir EXACTAMENTE con la registrada en Google Cloud, incluido el
 * esquema y sin barra final: Google compara la cadena, no la URL semánticamente.
 *
 * No lleva la subcuenta en la ruta a propósito — Google exige registrar cada URI una a una, así que
 * un callback por subcuenta obligaría a editar la consola cada vez que se crea una. La subcuenta
 * viaja firmada en `state` (ver lib/google/oauth-state.ts).
 */
export function googleRedirectUri(): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
  return `${base}/api/oauth/google/callback`
}

export type GoogleCredentials = { clientId: string; clientSecret: string }

/**
 * Cliente OAuth propiedad de la plataforma. Nunca depende de la subcuenta: el aislamiento lo dan
 * el state firmado y la fila tenant-scoped que contiene cada refresh token.
 */
export async function googleCredentials(): Promise<GoogleCredentials | null> {
  // Ajustes de plataforma (gestionados por super admin) primero; la variable de entorno es el respaldo.
  const clientId = await getPlatformSetting('GOOGLE_OAUTH_CLIENT_ID')
  const clientSecret = await getPlatformSetting('GOOGLE_OAUTH_CLIENT_SECRET')
  if (!clientId || !isGoogleOAuthClientId(clientId) || !clientSecret) return null
  return { clientId, clientSecret }
}

export function authorizationUrl(opts: {
  clientId: string
  scopes: string[]
  state: string
  codeChallenge: string
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', opts.clientId)
  url.searchParams.set('redirect_uri', googleRedirectUri())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', opts.scopes.join(' '))
  // offline + consent: sin esto Google NO devuelve refresh_token en las autorizaciones posteriores a
  // la primera, y la conexión dejaría de funcionar en cuanto caducara el access token.
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', opts.state)
  url.searchParams.set('code_challenge', opts.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export type TokenResponse = {
  access_token?: string
  refresh_token?: string
  scope?: string
  expires_in?: number
  error?: string
  error_description?: string
}

/**
 * Intercambia el código de autorización por tokens. `redirectUriOverride` solo existe para pruebas;
 * producción utiliza siempre el callback único registrado por la plataforma.
 */
export async function exchangeCode(
  code: string,
  creds: GoogleCredentials,
  codeVerifier: string,
  redirectUriOverride?: string
): Promise<TokenResponse> {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUriOverride || googleRedirectUri(),
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  return (await r.json().catch(() => ({}))) as TokenResponse
}

/** Revocación best-effort usada al desconectar. Google acepta access o refresh token. */
export async function revokeGoogleToken(token: string): Promise<boolean> {
  const body = new URLSearchParams({ token })
  const response = await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  })
  return response.ok
}

/** Email de la cuenta que autorizó, para que la pantalla diga de quién es la conexión. */
export async function fetchGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) return null
    const j = (await r.json()) as { email?: string }
    return j.email ?? null
  } catch {
    return null
  }
}
