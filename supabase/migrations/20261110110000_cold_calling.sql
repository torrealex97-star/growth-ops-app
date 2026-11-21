-- Cold calling — reparto de leads, historial de llamadas, comisión fija por venta y rol de manager
-- (10-nov-2026). Idempotente. Puerto MULTITENANT del módulo de cold callers del origen.
--
-- Qué había: el rol `cold_caller` existía a medias. No veía sus propias citas (las políticas de
-- lectura miraban setter_id y closer_id, nunca cold_caller_id), no tenía lista de leads que llamar,
-- ni registro de llamadas, ni comisión propia (cobraba, si acaso, disfrazado de setter).
--
-- Qué añade:
--   · `cold_calling_settings`     — ajustes POR SUBCUENTA: tramos de comisión, tamaño de tanda,
--                                   umbral para pedir más y objetivo. Sin fila = sin configurar: no
--                                   se inventa ningún importe (en el origen eran constantes en código).
--   · `cold_calling_assignments`  — a qué cold caller le toca cada lead de un lanzamiento (uno por
--                                   lead y lanzamiento) y en qué estado lo tiene.
--   · `cold_calling_events`       — historial que SOLO SE AÑADE. Es la prueba de que ella llamó antes
--                                   de la venta, y por tanto la fuente de verdad de su comisión.
--   · rol `cold_calling_manager`  — supervisa al equipo de cold calling sin recibir los permisos
--                                   generales de dirección.
--   · `participant_type='cold_caller'` en el ledger de comisiones (decisión D11 de docs/MONEY.md).
--   · lectura de sus propias citas y contactos para el cold caller.
--
-- El acceso de la app es SIEMPRE por service-role con tenant_id explícito; RLS queda como red de
-- seguridad (política RESTRICTIVE de subcuenta, igual que el resto de tablas multitenant) y el
-- anon / authenticated no reciben ningún GRANT sobre las tablas nuevas.

-- ── 1. Rol ───────────────────────────────────────────────────────────────────
INSERT INTO public.roles (key, name, description)
VALUES (
  'cold_calling_manager',
  'Manager de Cold Calling',
  'Supervisa al equipo de cold calling: reparto y reasignación de leads, actividad y comisiones del equipo.'
)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Ajustes por subcuenta ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cold_calling_settings (
  tenant_id            UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- [{ "desde": 1, "hasta": 3, "importe": 50 }, { "desde": 4, "hasta": null, "importe": 75 }]
  -- Importe FIJO por venta según el número de venta de la persona dentro del lanzamiento. Vacío =
  -- las cold callers de esta subcuenta no comisionan por venta (o aún no se ha decidido).
  tramos               JSONB NOT NULL DEFAULT '[]'::jsonb,
  tanda                INT  NOT NULL DEFAULT 20 CHECK (tanda BETWEEN 1 AND 200),
  pedir_mas_si_quedan  INT  NOT NULL DEFAULT 10 CHECK (pedir_mas_si_quedan BETWEEN 0 AND 200),
  objetivo_confirmados INT  CHECK (objetivo_confirmados IS NULL OR objetivo_confirmados BETWEEN 1 AND 100000),
  updated_by           UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cold_calling_settings_tramos_es_lista CHECK (jsonb_typeof(tramos) = 'array')
);

-- ── 3. Asignaciones ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cold_calling_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  launch_id       UUID NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  caller_id       UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  status          TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN (
                    'pendiente', 'no_contesta', 'whatsapp', 'llamado', 'confirmado',
                    'no_interesado', 'no_existe', 'asiste', 'no_asiste', 'nutricion')),
  quality         NUMERIC(4,1),                -- nota del lead al repartirlo (orden de la lista)
  notes           TEXT,
  recordatorio_at TIMESTAMPTZ,                 -- "llámame el jueves": cuándo volver a intentarlo
  intentos        INT NOT NULL DEFAULT 0,      -- llamadas registradas por la cold caller
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_called_at TIMESTAMPTZ,                 -- primera llamada de ELLA; nunca se mueve
  confirmed_at    TIMESTAMPTZ,                 -- primera vez que pasó a confirmado/asiste
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un lead está en la lista de UNA sola persona por lanzamiento: el reparto inserta con
-- ON CONFLICT DO NOTHING sobre este par, así que dos peticiones simultáneas no lo duplican.
CREATE UNIQUE INDEX IF NOT EXISTS cold_calling_assignments_launch_contact_key
  ON public.cold_calling_assignments (launch_id, contact_id);
-- La lista de una cold caller (su pantalla) y el recuento de pendientes.
CREATE INDEX IF NOT EXISTS cold_calling_assignments_caller_idx
  ON public.cold_calling_assignments (tenant_id, launch_id, caller_id, status);
-- "¿A quién le toca este contacto?" (comisión de una venta, ficha de la cita).
CREATE INDEX IF NOT EXISTS cold_calling_assignments_contact_idx
  ON public.cold_calling_assignments (tenant_id, contact_id);
-- FK sin índice: ON DELETE RESTRICT sobre users lo consulta.
CREATE INDEX IF NOT EXISTS cold_calling_assignments_caller_fk_idx
  ON public.cold_calling_assignments (caller_id);

-- ── 4. Historial (solo se añade) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cold_calling_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  assignment_id UUID NOT NULL REFERENCES public.cold_calling_assignments(id) ON DELETE CASCADE,
  launch_id     UUID NOT NULL REFERENCES public.launches(id) ON DELETE CASCADE,
  contact_id    UUID NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  -- De quién era el lead EN ESE MOMENTO. Tras una reasignación los eventos antiguos conservan a la
  -- anterior: una llamada suya no le da comisión a la nueva.
  caller_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  -- Quién hizo la acción. Explícito (no auth.uid(), que es NULL con service-role). Si actor_id no
  -- es caller_id (un manager corrigiendo un estado), el evento NO cuenta como llamada de ella.
  actor_id      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('asignado', 'estado', 'nota', 'recordatorio', 'reasignado')),
  status        TEXT,
  nota          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cold_calling_events_assignment_idx
  ON public.cold_calling_events (assignment_id, created_at);
-- Actividad reciente del equipo (panel del manager) y eventos de un contacto (comisión).
CREATE INDEX IF NOT EXISTS cold_calling_events_tenant_launch_idx
  ON public.cold_calling_events (tenant_id, launch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cold_calling_events_contact_idx
  ON public.cold_calling_events (tenant_id, contact_id);

-- El historial es la prueba que sostiene una comisión: no se edita ni se borra, ni siquiera con
-- service-role por descuido. (El borrado en cascada al eliminar el lanzamiento o el contacto sí
-- pasa: lo ejecuta el sistema de integridad referencial, no un UPDATE/DELETE directo.)
CREATE OR REPLACE FUNCTION public.cold_calling_events_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN COALESCE(OLD, NEW); -- borrado en cascada desde la tabla padre
  END IF;
  RAISE EXCEPTION 'cold_calling_events es de solo inserción: el historial no se modifica';
END;
$$;

DROP TRIGGER IF EXISTS cold_calling_events_no_update ON public.cold_calling_events;
CREATE TRIGGER cold_calling_events_no_update
  BEFORE UPDATE ON public.cold_calling_events
  FOR EACH ROW EXECUTE FUNCTION public.cold_calling_events_inmutable();

DROP TRIGGER IF EXISTS cold_calling_events_no_delete ON public.cold_calling_events;
CREATE TRIGGER cold_calling_events_no_delete
  BEFORE DELETE ON public.cold_calling_events
  FOR EACH ROW EXECUTE FUNCTION public.cold_calling_events_inmutable();

REVOKE ALL ON FUNCTION public.cold_calling_events_inmutable() FROM PUBLIC, anon, authenticated;

-- ── 5. RLS de las tablas nuevas ──────────────────────────────────────────────
-- Helpers de auth envueltos en SELECT para que Postgres los evalúe una vez (InitPlan).
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cold_calling_settings', 'cold_calling_assignments', 'cold_calling_events']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin())) WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()))',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;

-- ── 6. Comisión de la cold caller en el ledger (docs/MONEY.md, D11) ──────────
-- `commission_rules` NO se toca: sus reglas son porcentajes sobre lo cobrado y la cold caller cobra
-- un importe fijo por tramos, que vive en `cold_calling_settings`.
ALTER TABLE public.commissions
  DROP CONSTRAINT IF EXISTS commissions_participant_type_check;
ALTER TABLE public.commissions
  ADD CONSTRAINT commissions_participant_type_check
  CHECK (participant_type IN ('setter', 'closer', 'affiliate', 'collaborator', 'cold_caller'));

-- Una venta paga UNA comisión fija de cold calling, a una sola persona. Es lo que hace idempotente
-- la sincronización: una segunda pasada (o dos a la vez) no puede crear una segunda fila.
CREATE UNIQUE INDEX IF NOT EXISTS commissions_cold_caller_sale_key
  ON public.commissions (sale_id)
  WHERE participant_type = 'cold_caller' AND direction = 'positive';

-- ── 7. El cold caller ve sus propias citas y contactos ───────────────────────
-- Antes las dos políticas solo miraban setter_id y closer_id: la cita que él mismo había generado
-- (appointments.cold_caller_id) no le salía en Agendas. Se reescriben completas, conservando todas
-- las ramas que ya tenían y añadiendo la suya.
DROP POLICY IF EXISTS appointments_select_scope ON public.appointments;
CREATE POLICY appointments_select_scope ON public.appointments
  FOR SELECT
  USING (
    (SELECT public.is_admin_or_director())
    OR (SELECT public.is_team_scheduling_scope_allowed())
    OR setter_id = (SELECT auth.uid())
    OR closer_id = (SELECT auth.uid())
    OR cold_caller_id = (SELECT auth.uid())
    OR public.is_my_collaborator_row(contact_id)
  );

DROP POLICY IF EXISTS contacts_select_scope ON public.contacts;
CREATE POLICY contacts_select_scope ON public.contacts
  FOR SELECT
  USING (
    (SELECT public.is_admin_or_director())
    OR (SELECT public.is_team_scope_allowed())
    OR (
      (SELECT public.is_team_scheduling_scope_allowed())
      AND EXISTS (SELECT 1 FROM public.appointments a WHERE a.contact_id = contacts.id)
    )
    OR EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.contact_id = contacts.id
        AND (
          a.setter_id = (SELECT auth.uid())
          OR a.closer_id = (SELECT auth.uid())
          OR a.cold_caller_id = (SELECT auth.uid())
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.contact_id = contacts.id
        AND (s.setter_id = (SELECT auth.uid()) OR s.closer_id = (SELECT auth.uid()))
    )
    OR public.is_my_collaborator_row(id)
  );

-- La política de contactos filtra citas por cold_caller_id: el índice existente
-- (20260918120000) ya cubre esa columna, no se duplica.

-- El alcance "equipo" de agendas (data_scope = 'team') ya lo aplicaba el servidor a cold_caller
-- (lib/auth/acceso-por-propiedad.ts) pero RLS no: el servidor decía sí y la base de datos no. Se
-- alinean, y entra el manager de cold calling, que supervisa esas mismas agendas.
CREATE OR REPLACE FUNCTION public.is_team_scheduling_scope_allowed()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.id = auth.uid()
      AND u.data_scope = 'team'
      AND r.key IN ('admin', 'director', 'manager', 'closer', 'setter', 'cold_caller', 'cold_calling_manager')
  );
$$;
