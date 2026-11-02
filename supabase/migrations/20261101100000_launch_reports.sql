-- Informes de lanzamiento guardados (1-nov-2026). Idempotente.
-- Una instantánea del informe (DATA + ACCIONES) en un momento del lanzamiento: «intermedio» (a mitad
-- del calentamiento, para corregir sobre la marcha) y «final» (al cerrar el carrito). Se guarda el
-- JSON ya agregado —sin datos personales— para que el informe no cambie después aunque los datos
-- de origen sí lo hagan. Acceso por service-role con tenant_id explícito; RLS RESTRICTIVE como red.

CREATE TABLE IF NOT EXISTS public.launch_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  launch_id    UUID NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  momento      TEXT NOT NULL CHECK (momento IN ('intermedio', 'final')),
  datos        JSONB NOT NULL,
  generado_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  generado_por UUID REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS launch_reports_tenant_launch_idx
  ON public.launch_reports (tenant_id, launch_id, generado_at DESC);

ALTER TABLE public.launch_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.launch_reports FROM anon, authenticated;
DROP POLICY IF EXISTS launch_reports_tenant_isolation ON public.launch_reports;
CREATE POLICY launch_reports_tenant_isolation ON public.launch_reports AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()))
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()));
