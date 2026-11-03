-- ESTADO: APLICADA en producción el 2026-11-03, tras probarla en una transacción revertida con tres sesiones: la
-- colaboradora pasa de ver 7 usuarios a 3 (ella + closer/setter de sus ventas) y de 3 perfiles a 1, y conserva sus
-- 21 ventas y 38 comisiones (también con el cruce a `users`); un setter y una administradora siguen viendo 7 usuarios
-- y 3 perfiles. Verificada de nuevo en producción después de aplicarla. Es idempotente (CREATE OR REPLACE / DROP IF EXISTS).
--
-- PRIVACIDAD DEL COLABORADOR: ya no ve a todo el equipo ni los perfiles de otros colaboradores.
--
-- Detectado simulando la sesión de una colaboradora en la base de datos:
--   · `users_select` (auth_can_view_user) dejaba leer TODAS las columnas de TODOS los miembros de la subcuenta:
--     sueldo base, DNI, dirección, emails personales y teléfono de otras personas.
--   · `collaborator_profiles_select` dejaba ver el % de comisión y las notas de otros colaboradores.
--
-- Qué cambia (SOLO para el rol `affiliate`; el resto de roles se comporta exactamente igual):
--   · Un colaborador ve su propia fila y la de quien consta como closer o setter en las ventas de SUS clientes
--     (la pantalla de Registro de ventas muestra esos nombres). Ya no ve al resto del equipo.
--   · Un colaborador ve solo su propio perfil de colaborador.
--
-- LÍMITE conocido: las columnas sensibles de `users` siguen siendo legibles para quien SÍ puede ver esa fila (RLS
-- filtra filas, no columnas). Cerrarlo del todo exige mover esas columnas a una tabla solo-admin o leerlas por
-- servidor; queda como siguiente paso.
--
-- Marcha atrás: restaurar auth_can_view_user a su versión anterior
--   (target_user_id = auth.uid() OR is_super_admin() OR miembro de la misma subcuenta) y la política
--   collaborator_profiles_select con `tenant_id IN (SELECT auth_tenant_ids())` sin la condición de rol.

BEGIN;

CREATE OR REPLACE FUNCTION public.auth_can_view_user(target_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT target_user_id = auth.uid()
    OR public.is_super_admin()
    OR (
      EXISTS (
        SELECT 1
        FROM public.tenant_members mine
        JOIN public.tenant_members target ON target.tenant_id = mine.tenant_id
        WHERE mine.user_id = auth.uid() AND target.user_id = target_user_id
      )
      AND (
        public.get_my_role() IS DISTINCT FROM 'affiliate'
        OR EXISTS (
          SELECT 1
          FROM public.sales s
          WHERE (s.closer_id = target_user_id OR s.setter_id = target_user_id)
            AND public.is_my_collaborator_sale(s.id)
        )
      )
    );
$function$;

DROP POLICY IF EXISTS collaborator_profiles_select ON public.collaborator_profiles;
CREATE POLICY collaborator_profiles_select ON public.collaborator_profiles FOR SELECT USING (
  user_id = (SELECT auth.uid())
  OR is_super_admin()
  OR is_admin_or_director()
  OR (
    tenant_id IN (SELECT auth_tenant_ids())
    AND (SELECT get_my_role()) IS DISTINCT FROM 'affiliate'
  )
);

COMMIT;
