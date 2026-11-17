-- ESTADO: NO APLICADA en producción. Pendiente de dry-run + confirmación expresa (CLAUDE.md).
--
-- SOPs de la formación (17-nov-2026): varios documentos (enlaces) colgando de cada lección, bajo el vídeo.
-- Antes cada lección admitía UN solo recurso (`training_lessons.resource_url`/`resource_label`). Idempotente.
--
-- Mismo modelo de seguridad que el resto de `training_*`: acceso solo por rutas de servidor con service-role y
-- `tenant_id` explícito; RLS RESTRICTIVE como red de seguridad; la FK compuesta (tenant_id, lesson_id) impide que un
-- SOP cuelgue de una lección de OTRA subcuenta. Los SOPs son ENLACES https (Google Docs, Notion, PDF…): no se alojan
-- archivos aquí.
--
-- Las columnas antiguas `resource_url`/`resource_label` se COPIAN a esta tabla y se dejan sin usar; se eliminarán en una
-- migración aparte cuando se confirme que nada las lee (no se borra nada destructivo en este paso).
--
-- Marcha atrás: DROP TABLE training_resources (los datos originales siguen en las columnas antiguas).

CREATE TABLE IF NOT EXISTS public.training_resources (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lesson_id  UUID NOT NULL,
  title      TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  url        TEXT NOT NULL CHECK (char_length(url) <= 600 AND url ~ '^https://'),
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, lesson_id) REFERENCES public.training_lessons (tenant_id, id) ON DELETE CASCADE
);

-- Una consulta real: los SOPs de una lección en orden (la FK compuesta queda cubierta por este índice).
CREATE INDEX IF NOT EXISTS training_resources_lesson_pos_idx ON public.training_resources (tenant_id, lesson_id, position);

ALTER TABLE public.training_resources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.training_resources FROM anon, authenticated;
DROP POLICY IF EXISTS training_resources_tenant_isolation ON public.training_resources;
CREATE POLICY training_resources_tenant_isolation ON public.training_resources AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()))
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()));

-- Copia de lo que ya había (un recurso por lección). Idempotente: no duplica si ya se copió.
INSERT INTO public.training_resources (tenant_id, lesson_id, title, url, position)
SELECT l.tenant_id, l.id, COALESCE(NULLIF(btrim(l.resource_label), ''), 'Documento de apoyo'), l.resource_url, 0
FROM public.training_lessons l
WHERE l.resource_url IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.training_resources r WHERE r.tenant_id = l.tenant_id AND r.lesson_id = l.id);
