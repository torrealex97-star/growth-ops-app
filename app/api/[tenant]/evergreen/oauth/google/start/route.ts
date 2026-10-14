import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/auth/requireTenant'
import { authorizationUrl, googleCredentials, SCOPES } from '@/lib/google/oauth'
import { createSignedState } from '@/lib/google/oauth-state'
import { createPkce, GOOGLE_PKCE_COOKIE, sealPkce } from '@/lib/google/pkce'

export const runtime = 'nodejs'

// Inicia el flujo OAuth con Google para ESTA subcuenta. La subcuenta sale de la URL y la valida
// requireTenant; nunca del body ni de un parámetro, para que nadie pueda arrancar un flujo en nombre
// de otra. Después viaja firmada en `state`, porque el callback no la lleva en la ruta.
export async function GET(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const session = await requireTenant(tenant)
  if ('error' in session) return session.error
  const provider = new URL(req.url).searchParams.get('provider')
  if (provider !== 'ga4' && provider !== 'calendar' && provider !== 'youtube' && provider !== 'youtube_publish') {
    return NextResponse.json({ error: 'Proveedor de Google no válido' }, { status: 400 })
  }
  // GA4 y YouTube son conexiones del tenant y siguen siendo administrativas. Calendar es personal:
  // personal: cualquier miembro autenticado puede conectar LA SUYA, nunca la de otro usuario.
  if (provider !== 'calendar' && !session.isSuperAdmin && session.role !== 'admin' && session.role !== 'director') {
    return NextResponse.json({ error: 'Requiere rol de admin o director' }, { status: 403 })
  }

  const creds = await googleCredentials()
  if (!creds) {
    return NextResponse.json(
      {
        error: 'La plataforma todavía no tiene configurado el OAuth global de Google.',
      },
      { status: 400 }
    )
  }

  try {
    const signed = createSignedState({ tenant, provider, userId: session.userId })
    const pkce = createPkce()
    const response = NextResponse.redirect(
      authorizationUrl({
        clientId: creds.clientId,
        scopes: SCOPES[provider],
        state: signed.state,
        codeChallenge: pkce.challenge,
      })
    )
    response.cookies.set(
      GOOGLE_PKCE_COOKIE,
      sealPkce({
        nonce: signed.payload.nonce,
        userId: session.userId,
        provider,
        verifier: pkce.verifier,
      }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 10 * 60,
      }
    )
    return response
  } catch (e) {
    // Sin CONFIG_ENC_KEY no se puede firmar el state, y un state sin firma sería precisamente el
    // agujero que permite reclamar otra subcuenta. Antes falla que seguir sin firma.
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se pudo iniciar el flujo' }, { status: 500 })
  }
}
