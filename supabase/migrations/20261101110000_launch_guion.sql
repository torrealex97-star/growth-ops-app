-- Guion del webinar por lanzamiento (1-nov-2026). Idempotente.
-- El guion del evento es la fuente de la que nace todo el contenido del lanzamiento (emails, grupo,
-- stories, anuncios): se guarda en el lanzamiento para generar cada pieza del calendario con IA
-- sin pegarlo cada vez. Texto libre del negocio, sin datos personales.

ALTER TABLE public.launches ADD COLUMN IF NOT EXISTS guion_webinar TEXT;
ALTER TABLE public.launches DROP CONSTRAINT IF EXISTS launches_guion_webinar_len;
ALTER TABLE public.launches ADD CONSTRAINT launches_guion_webinar_len
  CHECK (guion_webinar IS NULL OR char_length(guion_webinar) <= 60000);
