-- Conexión PERSONAL de Fathom: cada closer pega su propia clave de API y la app recupera SUS
-- grabaciones y transcripciones (Fathom graba Google Meet, Zoom y Teams), además de la conexión de la
-- subcuenta. Antes solo había una clave por subcuenta, así que las reuniones de un closer que no
-- compartía su carpeta con el equipo no llegaban nunca.
--
-- La clave se guarda CIFRADA (misma CONFIG_ENC_KEY que integration_settings) y no vuelve a salir al
-- navegador. RLS activo SIN políticas y sin grants: solo el service role (la API de la app) lee y
-- escribe; cada API filtra por usuario y subcuenta.

CREATE TABLE IF NOT EXISTS public.user_fathom_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  api_key          text NOT NULL,
  key_fingerprint  text,
  status           text NOT NULL DEFAULT 'conectada' CHECK (status IN ('conectada', 'error')),
  last_sync_at     timestamptz,
  last_error       text,
  meetings_seen    integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS user_fathom_connections_sync_idx
  ON public.user_fathom_connections (last_sync_at NULLS FIRST);

ALTER TABLE public.user_fathom_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_fathom_connections FROM PUBLIC, anon, authenticated;

-- Defensa en profundidad (el invariante multitenant exige políticas en toda tabla con tenant_id): sin
-- grants ningún rol externo llega a la tabla, pero si alguien concediera acceso por error, estas dos
-- políticas acotan a «solo lo mío y de mis subcuentas».
CREATE POLICY user_fathom_connections_owner_select ON public.user_fathom_connections
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND tenant_id IN (SELECT public.auth_tenant_ids()));
CREATE POLICY user_fathom_connections_tenant_isolation ON public.user_fathom_connections
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (tenant_id IN (SELECT public.auth_tenant_ids()))
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()));

COMMENT ON TABLE public.user_fathom_connections IS
  'Clave de API de Fathom por closer (cifrada). Solo service role; la API filtra por usuario y subcuenta.';
