-- Lanzamientos — calendario de lanzamientos y apuntados por lanzamiento (23-oct-2026). Idempotente.
--
-- Puerto del módulo L1 de iawinners a multitenant. En el origen el calendario era una constante de
-- lib/launch/config.ts y las tablas no tenían tenant_id; aquí el lanzamiento ACTIVO es dato, por
-- subcuenta, y se abre desde el panel /lanzamiento con el botón "Abrir siguiente".
--
--   · `launches` — el calendario. Activo = el abierto (opened_at NOT NULL) con la fecha más reciente.
--     Los programados (opened_at NULL) no existen para el resto de la app hasta que se abren.
--   · `contact_launches` — el apuntado de un contacto a un lanzamiento. La fila se crea al registrar
--     el lead y vive ahí hasta que se confirma (confirmed_at), se invita (invitado_at) o se mueve al
--     siguiente lanzamiento al abrirlo (UPDATE contact_launches SET launch_id = ...).
--
-- El acceso en la app es siempre por service-role con tenant_id explícito; RLS queda como red de
-- seguridad para lecturas directas de authenticated (misma política RESTRICTIVE que las demás tablas
-- multitenant, 20260911150000).

CREATE TABLE IF NOT EXISTS public.launches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,                   -- "lanzamiento-28-oct"; se muestra, no se usa como id
  label       TEXT NOT NULL,
  fecha       DATE NOT NULL,                   -- día del evento
  opened_at   TIMESTAMPTZ,                     -- NULL = programado, aún no abierto
  opened_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  movidos     INT,                             -- apuntados traídos del anterior al abrirlo
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un contacto puede estar apuntado una sola vez a cada lanzamiento: la apertura mueve filas del
-- lanzamiento anterior y ese movimiento debe ser idempotente por este par.
CREATE TABLE IF NOT EXISTS public.contact_launches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  launch_id       UUID NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ,                 -- primera marca, nunca se mueve (idempotente)
  confirm_source  TEXT,                        -- "webhook-movil", "manual"…
  invitado_at     TIMESTAMPTZ,                 -- invitación al evento marcada desde el panel
  invitado_por    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  utm             JSONB                        -- UTMs con las que se apuntó (ranking de anuncios)
);

CREATE UNIQUE INDEX IF NOT EXISTS launches_tenant_slug_key  ON public.launches (tenant_id, slug);
CREATE UNIQUE INDEX IF NOT EXISTS launches_tenant_fecha_key ON public.launches (tenant_id, fecha);
CREATE UNIQUE INDEX IF NOT EXISTS contact_launches_launch_contact_key
  ON public.contact_launches (launch_id, contact_id);

-- El activo y el calendario se leen por fecha: el índice de launches ya cubre (tenant_id, fecha).
CREATE INDEX IF NOT EXISTS contact_launches_tenant_contact_idx ON public.contact_launches (tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS contact_launches_tenant_launch_idx  ON public.contact_launches (tenant_id, launch_id);

-- Toda tabla accesible por Supabase tiene RLS explícita (regla del repo). Aquí no hay lógica por
-- fila de negocio: la política RESTRICTIVE de tenant es la única, igual que las demás tablas
-- multitenant. El anon y el authenticated no reciben permisos GRANT de inserción/escritura.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['launches', 'contact_launches']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin()) WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR public.is_super_admin())',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;
