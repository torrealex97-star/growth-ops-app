/**
 * Endpoint de autorización OAuth 2.1 del servidor MCP.
 *
 * GET: valida la petición y muestra la pantalla de consentimiento (requiere sesión Supabase).
 * POST: con la sesión activa y `approve=1`, emite el código y redirige al cliente con él.
 *
 * El consentimiento es la barrera de propiedad: aprobar fija owner_user_id del cliente al
 * usuario con sesión, así un client_id registrado dinámicamente por cualquiera no puede
 * leer datos hasta que TÚ lo apruebas en tu sesión de la app. Es el mismo patrón del resto
 * del repo: la autorización vive en servidor, nunca en lo que manda el cliente.
 */
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { htmlConsentimiento } from '@/lib/mcp/consentimiento'
import { emitirCodigo, validarAutorizacion } from '@/lib/mcp/oauth'

async function sesionActual(): Promise<{ userId: string; superAdmin: boolean } | null> {
  const cookieStore = await cookies()
  const authed = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll() {},
    },
  })
  const {
    data: { user },
  } = await authed.auth.getUser()
  if (!user) return null
  const { data: sa } = await authed.rpc('is_super_admin')
  return { userId: user.id, superAdmin: sa === true }
}

function paginaConsentimiento(opts: Parameters<typeof htmlConsentimiento>[0]) {
  return new NextResponse(htmlConsentimiento(opts), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams
  const validacion = await validarAutorizacion({
    response_type: p.get('response_type'),
    client_id: p.get('client_id'),
    redirect_uri: p.get('redirect_uri'),
    code_challenge: p.get('code_challenge'),
    code_challenge_method: p.get('code_challenge_method'),
    scope: p.get('scope'),
    state: p.get('state'),
  })
  // Error con redirect_uri verificada: se manda por redirect (estándar). Sin ella, HTML.
  if (validacion.error) {
    if (validacion.redirectUri) {
      const url = new URL(validacion.redirectUri)
      url.searchParams.set('error', 'invalid_request')
      url.searchParams.set('error_description', validacion.error)
      if (validacion.state) url.searchParams.set('state', validacion.state)
      return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store' } })
    }
    return paginaConsentimiento({
      clientName: 'Cliente MCP',
      clientId: p.get('client_id') ?? '',
      params: p,
      error: validacion.error,
    })
  }

  const sesion = await sesionActual()
  if (!sesion) {
    const login = new URL('/login', request.nextUrl.origin)
    login.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(login, { headers: { 'Cache-Control': 'no-store' } })
  }

  return paginaConsentimiento({
    clientName: validacion.clientName ?? 'Cliente MCP',
    clientId: p.get('client_id') ?? '',
    params: p,
    superAdmin: sesion.superAdmin,
  })
}

/**
 * Redirección tras el POST del formulario de consentimiento. DEBE ser 303 (See Other): el 307 que
 * `NextResponse.redirect` usa por defecto conserva el método, así que el navegador reenviaba el POST
 * (con el formulario entero) a la URL de retorno de ChatGPT/Claude, que lo rechazaba con «Bad Request»
 * justo después de pulsar Autorizar. Con 303 el navegador la pide con GET, como exige OAuth.
 */
function redirigirTrasPost(url: URL) {
  return NextResponse.redirect(url, { status: 303, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  const form = await request.formData()
  const p = new URLSearchParams()
  for (const key of [
    'response_type',
    'client_id',
    'redirect_uri',
    'code_challenge',
    'code_challenge_method',
    'scope',
    'state',
  ]) {
    const v = form.get(key)
    if (typeof v === 'string') p.set(key, v)
  }
  const approve = form.get('approve') === '1'

  const validacion = await validarAutorizacion({
    response_type: p.get('response_type'),
    client_id: p.get('client_id'),
    redirect_uri: p.get('redirect_uri'),
    code_challenge: p.get('code_challenge'),
    code_challenge_method: p.get('code_challenge_method'),
    scope: p.get('scope'),
    state: p.get('state'),
  })
  if (validacion.error || !validacion.redirectUri) {
    return paginaConsentimiento({
      clientName: 'Cliente MCP',
      clientId: p.get('client_id') ?? '',
      params: p,
      error: validacion.error ?? 'Petición inválida',
    })
  }

  const url = new URL(validacion.redirectUri)
  if (validacion.state) url.searchParams.set('state', validacion.state)

  if (!approve) {
    url.searchParams.set('error', 'access_denied')
    url.searchParams.set('error_description', 'El usuario denegó el acceso')
    return redirigirTrasPost(url)
  }

  const sesion = await sesionActual()
  if (!sesion) return redirigirTrasPost(new URL('/login', request.nextUrl.origin))

  const code = await emitirCodigo({
    clientId: p.get('client_id')!,
    userId: sesion.userId,
    redirectUri: validacion.redirectUri,
    scope: p.get('scope') || 'read',
    codeChallenge: p.get('code_challenge')!,
  })
  // La propiedad del cliente se fija en el primer consentimiento: de aquí en adelante solo
  // este usuario ve y puede revocar este cliente.
  const { asignarPropietario } = await import('@/lib/mcp/store')
  await asignarPropietario(p.get('client_id')!, sesion.userId)

  url.searchParams.set('code', code)
  return redirigirTrasPost(url)
}
