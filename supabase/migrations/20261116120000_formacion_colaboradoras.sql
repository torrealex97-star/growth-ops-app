-- ESTADO: NO APLICADA en producción. Pendiente de dry-run + confirmación expresa (CLAUDE.md).
--
-- Formación del equipo (16-nov-2026): cursos con lecciones en vídeo/SOP y progreso por persona, dirigidos a uno o
-- varios roles (media buyers, closers, colaboradoras…).
-- Idempotente (IF NOT EXISTS / DROP POLICY IF EXISTS).
--
-- Contenido POR SUBCUENTA: cada admin crea sus cursos. El vídeo NO se aloja aquí: `video_url` es un enlace
-- externo (Bunny, YouTube, Loom, Wistia, Vimeo) y la app solo guarda la URL ya validada contra una lista
-- blanca de hosts (lib/formacion/video.ts). Cero egress de vídeo en Supabase.
--
-- Acceso: SOLO por rutas de servidor con service-role y `tenant_id` explícito (mismo patrón que
-- `launch_checklist`); RLS RESTRICTIVE como red de seguridad por si alguna vez se lee con sesión.
-- Las FK compuestas (tenant_id, id) impiden que una lección cuelgue de un curso de OTRA subcuenta o que un
-- progreso apunte a una lección ajena.
--
-- Marcha atrás: DROP TABLE training_progress, training_lessons, training_courses (en ese orden).

CREATE TABLE IF NOT EXISTS public.training_courses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description TEXT CHECK (description IS NULL OR char_length(description) <= 2000),
  -- Clave estable de un curso sembrado (p. ej. 'estandar'): un solo curso por clave y subcuenta, aunque
  -- se renombre o se pulse dos veces el botón de sembrar. NULL para los cursos creados a mano.
  seed_key    TEXT CHECK (seed_key IS NULL OR seed_key ~ '^[a-z0-9_-]{1,40}$'),
  -- Público del curso por rol funcional (setter, closer, affiliate, marketing…). NULL = lo ve todo el equipo.
  -- Quien administra la subcuenta ve todos los cursos, sea cual sea su público. La app valida los valores.
  audience_roles TEXT[] CHECK (audience_roles IS NULL OR cardinality(audience_roles) BETWEEN 1 AND 20),
  position    INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS public.training_lessons (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  course_id      UUID NOT NULL,
  title          TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description    TEXT CHECK (description IS NULL OR char_length(description) <= 4000),
  -- Defensa en profundidad: aunque algo escriba sin pasar por lib/formacion/video.ts, el iframe solo puede
  -- apuntar a un embed canónico de la lista blanca.
  video_url      TEXT CHECK (video_url IS NULL OR (char_length(video_url) <= 600 AND video_url ~
    '^https://(www\.youtube-nocookie\.com/embed/|www\.loom\.com/embed/|fast\.wistia\.net/embed/iframe/|player\.vimeo\.com/video/|iframe\.mediadelivery\.net/embed/)[A-Za-z0-9_/?=&-]+$')),
  video_provider TEXT CHECK (video_provider IS NULL OR video_provider IN ('youtube', 'loom', 'wistia', 'vimeo', 'bunny')),
  -- Recurso de apoyo (p. ej. el manual): un ENLACE https que se abre en pestaña nueva, no se incrusta.
  resource_url   TEXT CHECK (resource_url IS NULL OR (char_length(resource_url) <= 600 AND resource_url ~ '^https://')),
  resource_label TEXT CHECK (resource_label IS NULL OR char_length(resource_label) <= 80),
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, course_id) REFERENCES public.training_courses (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.training_progress (
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  lesson_id    UUID NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id),
  FOREIGN KEY (tenant_id, lesson_id) REFERENCES public.training_lessons (tenant_id, id) ON DELETE CASCADE
);

-- Un índice por consulta real: lista de cursos por subcuenta, lecciones de un curso en orden, y el progreso
-- de una persona dentro de su subcuenta. La FK compuesta de lecciones (tenant_id, course_id) la cubre su propio índice.
CREATE INDEX IF NOT EXISTS training_courses_tenant_pos_idx ON public.training_courses (tenant_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS training_courses_seed_key_uidx ON public.training_courses (tenant_id, seed_key) WHERE seed_key IS NOT NULL;
-- FK created_by (ON DELETE SET NULL): sin índice, borrar un usuario obligaría a recorrer la tabla entera.
CREATE INDEX IF NOT EXISTS training_courses_created_by_idx ON public.training_courses (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS training_lessons_course_pos_idx ON public.training_lessons (tenant_id, course_id, position);
CREATE INDEX IF NOT EXISTS training_progress_tenant_user_idx ON public.training_progress (tenant_id, user_id);
-- La FK compuesta (tenant_id, lesson_id) de progreso se usa al borrar una lección: la cubre este índice.
CREATE INDEX IF NOT EXISTS training_progress_lesson_idx ON public.training_progress (tenant_id, lesson_id);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['training_courses', 'training_lessons', 'training_progress'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL '
      || 'USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin())) '
      || 'WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()))',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
