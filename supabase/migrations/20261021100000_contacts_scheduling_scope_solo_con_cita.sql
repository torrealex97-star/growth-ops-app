-- CORRECCIÓN de la política contacts_select_scope introducida en 20261019200000.
--
-- Aquella migración dio a closer/setter con data_scope='team' lectura de TODOS los contactos de la
-- subcuenta (nombre, teléfono, email), cuando solo hacía falta que vieran los contactos de las
-- citas que ya pueden ver en el calendario de equipo. F01 (20261003082207) había dejado los
-- contactos del equipo entero solo para liderazgo.
--
-- Esta versión:
--   · liderazgo (admin/director/manager con alcance equipo): vuelve a ver todos, como antes del #566;
--   · closer/setter con alcance equipo: solo contactos con AL MENOS UNA cita (lo que necesita la
--     pantalla de Agendas, que embebe contacts(*)); NO los leads sin agendar;
--   · el resto de ramas (citas/ventas propias, colaborador) no cambia.
--
-- `(select …)` alrededor del helper permite InitPlan (una evaluación por consulta, no por fila), como
-- exige docs/FREE_TIER_OPERATIONS.md. La subconsulta usa idx_appointments_contact_id.
-- El EXISTS sobre appointments es el mismo patrón que ya usa esta política para citas propias, así que
-- no introduce recursión nueva entre políticas.
--
-- APLICAR con dry-run primero: verificar que (a) una closer con data_scope='team' ve exactamente los
-- contactos que tienen cita (y no los demás), (b) sigue resolviendo contacts(*) en Agendas, (c) un
-- afiliado de control no gana ninguna fila, (d) liderazgo ve todo. Después get_advisors.

ALTER POLICY contacts_select_scope ON public.contacts
  USING (
    is_admin_or_director()
    OR is_team_scope_allowed()
    OR (
      (select is_team_scheduling_scope_allowed())
      AND EXISTS (SELECT 1 FROM appointments a WHERE a.contact_id = contacts.id)
    )
    OR (EXISTS ( SELECT 1 FROM appointments a WHERE (a.contact_id = contacts.id) AND ((a.setter_id = auth.uid()) OR (a.closer_id = auth.uid())))) OR (EXISTS ( SELECT 1 FROM sales s WHERE (s.contact_id = contacts.id) AND ((s.setter_id = auth.uid()) OR (s.closer_id = auth.uid()))))
    OR is_my_collaborator_row(id)
  );
