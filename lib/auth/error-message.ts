type AuthErrorLike = { code?: string; message?: string } | null | undefined

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: 'El email o la contraseña no son correctos.',
  email_not_confirmed: 'Confirma tu email antes de iniciar sesión.',
  over_request_rate_limit: 'Has hecho demasiados intentos. Espera unos minutos y vuelve a probar.',
  too_many_requests: 'Has hecho demasiados intentos. Espera unos minutos y vuelve a probar.',
  user_banned: 'Esta cuenta está desactivada. Contacta con administración.',
  otp_expired: 'El enlace ha caducado. Solicita uno nuevo.',
}

export function authErrorMessage(error: AuthErrorLike): string {
  if (error?.code && AUTH_MESSAGES[error.code]) return AUTH_MESSAGES[error.code]

  const normalized = error?.message?.toLowerCase() ?? ''
  if (normalized.includes('invalid login credentials')) return AUTH_MESSAGES.invalid_credentials
  if (normalized.includes('email not confirmed')) return AUTH_MESSAGES.email_not_confirmed
  if (normalized.includes('rate limit') || normalized.includes('too many requests'))
    return AUTH_MESSAGES.too_many_requests

  return 'No se pudo iniciar sesión. Inténtalo de nuevo.'
}
