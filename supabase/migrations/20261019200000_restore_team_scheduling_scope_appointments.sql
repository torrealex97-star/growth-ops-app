-- FIX — "no le salen sus agendas" reportado por una closer (Daniele) al elegir «Todo el equipo»
-- en el calendario de Agendas (app/[tenant]/crm/agendas/page.tsx).
--
-- Causa raíz: la migración de seguridad 20261003120000 (hallazgo F01, DASHBOARD_AUDIT.md) cerró el
-- bypass de `data_scope='team'` en appointments para que solo liderazgo (admin/director/manager) lo
-- disfrutara — correcto para afiliados viendo ventas/cobros ajenos, que era el hallazgo real. Pero
-- la pantalla de Agendas tiene su propio selector «Todo el equipo» (visible a cualquiera con
-- `data_scope='team'`, sin mirar el rol — así lleva construido desde antes de esa migración),
-- pensado para que closers/setters coordinen el calendario del equipo entero y no se pisen citas.
-- Al no distinguir rol, el fix de seguridad también le quitó esa función operativa a closers/
-- setters con `data_scope='team'`: veían solo sus propias citas (p.ej. Daniele pasó de ver el
-- calendario completo a solo sus 22 propias) aun con el selector ofreciéndoles «todo el equipo».
--
-- Verificado el caso real: Claudia (rol admin) es closer_id/setter_id en 726 de 749 citas — es
-- quien de hecho lleva el calendario del equipo. Con el bug, Daniele (closer) no veía ninguna de
-- esas 726 al elegir «todo el equipo», solo las 22 suyas.
--
-- Fix ACOTADO a appointments (no a sales/collections/contact_attributions/contacts/activities/
-- stripe_payments, que sí tienen datos financieros o de PII sensible más allá de agendar): nueva
-- función que amplía los roles permitidos a admin/director/manager/closer/setter — EXCLUYE
-- affiliate y el resto de roles sin función de agendar, así que el hallazgo original de F01 (un
-- afiliado viendo ventas/cobros del equipo) sigue cerrado. Verificado con dry-run: Daniele pasa de
-- 22 a 748/749 citas visibles; un afiliado de control (mismo data_scope='team') no gana ni una cita
-- más (184 antes y después, las suyas por atribución).

CREATE OR REPLACE FUNCTION public.is_team_scheduling_scope_allowed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.roles r ON r.id = u.role_id
    WHERE u.id = auth.uid()
      AND u.data_scope = 'team'
      AND r.key IN ('admin', 'director', 'manager', 'closer', 'setter')
  );
$$;

REVOKE ALL ON FUNCTION public.is_team_scheduling_scope_allowed() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_team_scheduling_scope_allowed() TO authenticated;

ALTER POLICY appointments_select_scope ON public.appointments
  USING (is_admin_or_director() OR is_team_scheduling_scope_allowed() OR (setter_id = auth.uid()) OR (closer_id = auth.uid()) OR is_my_collaborator_row(contact_id));

-- Companero obligatorio: la pantalla de Agendas embebe `contacts(*)` en la misma consulta. Sin este
-- mismo permiso en `contacts`, las 726 citas de Claudia habrían aparecido para Daniele con el
-- contacto en blanco (verificado: solo 3/726 resolvían antes de este ALTER) — mismas filas, pero
-- sin nombre/teléfono, que visualmente es casi igual de inútil que no verlas.
ALTER POLICY contacts_select_scope ON public.contacts
  USING (is_admin_or_director() OR is_team_scheduling_scope_allowed() OR (EXISTS ( SELECT 1 FROM appointments a WHERE (a.contact_id = contacts.id) AND ((a.setter_id = auth.uid()) OR (a.closer_id = auth.uid())))) OR (EXISTS ( SELECT 1 FROM sales s WHERE (s.contact_id = contacts.id) AND ((s.setter_id = auth.uid()) OR (s.closer_id = auth.uid())))) OR is_my_collaborator_row(id));
