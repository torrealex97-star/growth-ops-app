-- ESTADO: APLICADA en producción el 19-nov-2026 (tras simulación revertida).
--
-- Los tokens de Google (`refresh_token`, `access_token`) solo los lee y escribe el servidor con service-role.
-- Hasta ahora `anon` y `authenticated` tenían permisos completos de tabla: lo único que impedía leer los tokens desde
-- el navegador eran las políticas RLS (admin/director de la propia subcuenta). Un fallo en una política los habría
-- abierto. Ahora el permiso falta de raíz, además de la política.
--
-- Qué cambia: `anon` pierde todo; `authenticated` conserva SOLO `SELECT` de las columnas no sensibles (la pantalla de
-- Funnels lee `ga4_property_id`, `status`, `last_sync_at`). Nada de `INSERT/UPDATE/DELETE/TRUNCATE` ni de los tokens.
-- Todo el código que toca tokens usa service-role (callback OAuth, token-store, rutas de GA4/Calendar/YouTube/Integraciones).
--
-- Marcha atrás: GRANT ALL ON public.google_oauth_connections TO anon, authenticated;
-- Si se añade una columna NO sensible que la app deba leer con sesión, hay que concederla aquí explícitamente.

REVOKE ALL ON public.google_oauth_connections FROM anon, authenticated;
GRANT SELECT (
  id, tenant_id, provider, google_email, scopes, ga4_property_id, status, last_sync_at, last_error,
  connected_by, created_at, updated_at, owner_user_id, access_token_expires_at, last_refresh_at, reauth_required_at
) ON public.google_oauth_connections TO authenticated;
