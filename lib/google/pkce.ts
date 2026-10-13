import crypto from 'crypto'
import { decryptSecret, encryptSecret } from '@/lib/config'
import type { GoogleProvider } from '@/lib/google/oauth'

// El prefijo __Host- exige Secure; en localhost HTTP el navegador descartaría la cookie completa.
export const GOOGLE_PKCE_COOKIE =
  process.env.NODE_ENV === 'production' ? '__Host-google-oauth-pkce' : 'google-oauth-pkce'

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

type PkceEnvelope = {
  nonce: string
  userId: string
  provider: GoogleProvider
  verifier: string
}

export function sealPkce(input: PkceEnvelope): string {
  return encryptSecret(JSON.stringify(input))
}

export function openPkce(value: string | null | undefined): PkceEnvelope | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(decryptSecret(value)) as Partial<PkceEnvelope>
    if (
      typeof parsed.nonce !== 'string' ||
      typeof parsed.userId !== 'string' ||
      typeof parsed.verifier !== 'string' ||
      (parsed.provider !== 'ga4' &&
        parsed.provider !== 'calendar' &&
        parsed.provider !== 'youtube' &&
        parsed.provider !== 'youtube_publish')
    ) {
      return null
    }
    return parsed as PkceEnvelope
  } catch {
    return null
  }
}
