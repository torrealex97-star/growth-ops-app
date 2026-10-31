-- Contenido del lanzamiento — calendario de nutrición multicanal y descargables (31-oct-2026). Idempotente.
--
-- Puerto de `launch_content` (v94) de iawinners a multitenant. Cada pieza se fecha RELATIVA al evento
-- (dia = -3 → tres días antes) para que «Copiar del anterior» traiga la secuencia tal cual al
-- lanzamiento nuevo. El acceso va por service-role con tenant_id explícito; RLS RESTRICTIVE como red
-- de seguridad (mismo patrón que `launches`, 20261023100000).

CREATE TABLE IF NOT EXISTS public.launch_content (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  launch_id      UUID NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL DEFAULT 'publicacion' CHECK (tipo IN ('publicacion', 'descargable')),
  canal          TEXT NOT NULL DEFAULT 'whatsapp'
                 CHECK (canal IN ('email','whatsapp','encuesta','winners','grabar','stories','reel','post','directo','otro')),
  dia            INT CHECK (dia IS NULL OR dia BETWEEN -60 AND 60),
  hora           TEXT CHECK (hora IS NULL OR hora ~ '^\d{1,2}:\d{2}$'),
  titulo         TEXT NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 200),
  texto          TEXT,
  enlace         TEXT,
  estado         TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'listo', 'publicado')),
  responsable_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_by     UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS launch_content_tenant_launch_idx ON public.launch_content (tenant_id, launch_id, dia, hora);
-- FK sin índice propio: responsable_id/created_by se consultan poco; el CASCADE de users es raro.

ALTER TABLE public.launch_content ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.launch_content FROM anon, authenticated;
DROP POLICY IF EXISTS launch_content_tenant_isolation ON public.launch_content;
CREATE POLICY launch_content_tenant_isolation ON public.launch_content AS RESTRICTIVE FOR ALL
  USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()))
  WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()));
