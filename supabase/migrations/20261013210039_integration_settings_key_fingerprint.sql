-- Identifica, sin revelar la llave, qué CONFIG_ENC_KEY cifró cada secreto. Las filas históricas
-- quedan NULL y se siguen probando con AES-GCM; la próxima regrabación escribe el fingerprint.
ALTER TABLE public.integration_settings
  ADD COLUMN IF NOT EXISTS key_fingerprint TEXT;

COMMENT ON COLUMN public.integration_settings.key_fingerprint IS
  'Fingerprint HMAC truncado de CONFIG_ENC_KEY; nunca contiene la llave ni el secreto en claro.';
