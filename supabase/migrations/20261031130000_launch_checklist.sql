-- Checklist de lanzamiento — ítems marcados por lanzamiento (31-oct-2026). Idempotente.
-- Una fila = un ítem hecho; desmarcar la borra. Los ítems son una constante en la app
-- (lib/launch/plantilla.ts), no datos. Acceso por service-role con tenant_id explícito; RLS
-- RESTRICTIVE como red de seguridad (mismo patrón que `launches`).

CREATE TABLE IF NOT EXISTS public.launch_checklist (
  tenant_id  UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  launch_id  UUID NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  item_key   TEXT NOT NULL CHECK (char_length(item_key) BETWEEN 1 AND 80),
  done_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  done_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  PRIMARY KEY (launch_id, item_key)
);

CREATE INDEX IF NOT EXISTS launch_checklist_tenant_idx ON public.launch_checklist (tenant_id, launch_id);

ALTER TABLE public.launch_checklist ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.launch_checklist FROM anon, authenticated;
DROP POLICY IF EXISTS launch_checklist_tenant_isolation ON public.launch_checklist;
CREATE POLICY launch_checklist_tenant_isolation ON public.launch_checklist AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()))
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()));
