-- Ajustes GLOBALES de la plataforma (no pertenecen a una subcuenta): cliente OAuth de Google, secreto
-- del webhook de onboarding… Hasta ahora solo existían como variables de entorno de Vercel, lo que
-- obligaba a entrar en el panel de Vercel y redeplegar para cambiarlos. Aquí los gestiona un super admin
-- desde la propia app; la variable de entorno sigue valiendo como respaldo.
--
-- Los secretos se guardan CIFRADOS con la misma CONFIG_ENC_KEY que `integration_settings` (aes-256-gcm,
-- con huella de la llave). RLS activo y SIN políticas a propósito: solo el service role lee y escribe;
-- ni `anon` ni `authenticated` pueden tocar la tabla por la API de datos.

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key             text PRIMARY KEY,
  value           text NOT NULL,
  is_secret       boolean NOT NULL DEFAULT true,
  key_fingerprint text,
  updated_by      uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_settings FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.platform_settings IS
  'Ajustes globales de plataforma gestionados por super admin. Solo service role (RLS sin políticas).';
