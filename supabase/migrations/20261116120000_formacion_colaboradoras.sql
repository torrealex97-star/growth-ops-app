-- ESTADO: NO APLICADA en producción. Pendiente de dry-run + confirmación expresa (CLAUDE.md).
--
-- Formación de colaboradoras (16-nov-2026): cursos con lecciones en vídeo y progreso por persona.
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
  video_url      TEXT CHECK (video_url IS NULL OR char_length(video_url) <= 600),
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
