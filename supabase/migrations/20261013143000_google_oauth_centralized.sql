-- OAuth de Google centralizado en un único cliente propiedad de la plataforma.
-- Las credenciales del cliente viven solo en Vercel; esta tabla contiene únicamente los tokens
-- tenant-scoped que resultan del consentimiento de cada cuenta.

ALTER TABLE public.google_oauth_connections
  DROP CONSTRAINT IF EXISTS google_oauth_connections_provider_check;

-- `gmail` se conserva únicamente para poder revocar/migrar conexiones históricas. Ningún flujo
-- nuevo lo ofrece y el runtime ya no consume esos tokens.
ALTER TABLE public.google_oauth_connections
  ADD CONSTRAINT google_oauth_connections_provider_check
  CHECK (provider IN ('ga4', 'gmail', 'calendar', 'youtube', 'youtube_publish'));

ALTER TABLE public.google_oauth_connections
  ADD COLUMN IF NOT EXISTS access_token TEXT,
  ADD COLUMN IF NOT EXISTS access_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_refresh_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reauth_required_at TIMESTAMPTZ;

COMMENT ON COLUMN public.google_oauth_connections.access_token IS
  'Access token cifrado con CONFIG_ENC_KEY; nunca se expone al cliente.';
COMMENT ON COLUMN public.google_oauth_connections.reauth_required_at IS
  'Marca que el refresh token fue revocado o no puede descifrarse y exige consentimiento nuevo.';

DROP INDEX IF EXISTS public.google_oauth_tenant_provider_key;
CREATE UNIQUE INDEX google_oauth_tenant_provider_key
  ON public.google_oauth_connections (tenant_id, provider)
  WHERE provider IN ('ga4', 'gmail', 'youtube', 'youtube_publish');

-- Calendar sigue siendo una conexión personal por miembro; las conexiones administrativas no
-- deben llevar owner_user_id.
ALTER TABLE public.google_oauth_connections
  DROP CONSTRAINT IF EXISTS google_oauth_calendar_requires_owner;

-- Las versiones anteriores no prohibían owner_user_id en conexiones administrativas. Se normaliza
-- antes de añadir el CHECK para que una fila histórica accidental no bloquee todo el despliegue.
UPDATE public.google_oauth_connections
SET owner_user_id = NULL
WHERE provider <> 'calendar' AND owner_user_id IS NOT NULL;

ALTER TABLE public.google_oauth_connections
  ADD CONSTRAINT google_oauth_owner_shape_check
  CHECK (
    (provider = 'calendar' AND owner_user_id IS NOT NULL)
    OR (provider <> 'calendar' AND owner_user_id IS NULL)
  );

