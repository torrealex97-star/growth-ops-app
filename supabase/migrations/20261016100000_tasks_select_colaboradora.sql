-- Tareas: una colaboradora (rol affiliate) solo puede LEER las tareas asignadas a ella o creadas por
-- ella. Hasta ahora `tasks_select_team` dejaba leer todas las tareas de la subcuenta a cualquier
-- miembro, y el filtro de la pantalla era la única barrera. El resto de roles no cambia.
--
-- `(select ...)` en las dos funciones para que Postgres las evalúe una vez por consulta (InitPlan) y
-- no por fila (docs/FREE_TIER_OPERATIONS.md).
DROP POLICY IF EXISTS tasks_select_team ON public.tasks;

CREATE POLICY tasks_select_team ON public.tasks
  FOR SELECT
  USING (
    (
      tenant_id IN (SELECT auth_tenant_ids())
      OR is_super_admin()
      OR is_admin_or_director()
    )
    AND (
      (SELECT get_my_role()) IS DISTINCT FROM 'affiliate'
      OR assignee_id = (SELECT auth.uid())
      OR created_by = (SELECT auth.uid())
    )
  );
