-- ESTADO: NO APLICADA hasta confirmar (CLAUDE.md). Paso (a) de 3 de `user_private`; es ADITIVO y no rompe nada.
--
-- Datos personales y económicos de cada persona (sueldo, fijo, meta, DNI, dirección, email personal). Hasta ahora vivían
-- en `users`, y `users_select` deja leer la fila ENTERA a cualquier miembro de la subcuenta: un closer o setter con
-- `data_scope = 'team'` podía leer el sueldo, DNI y dirección de sus compañeros (comprobado con una sesión simulada).
--
-- Plan en 3 pasos (una columna cada vez es peor que moverlas todas):
--   (a) ESTA migración: tabla `user_private` + RLS + copia de los datos actuales.
--   (b) Código: pantallas y rutas leen y escriben en `user_private`.
--   (c) Con el código desplegado y verificado: vaciar esas columnas en `users` (y, más adelante, DROP COLUMN).
--
-- Acceso: la propia persona LEE su fila (el dashboard muestra su fijo y su meta); quien administra una subcuenta
-- que comparte con ella (`auth_can_manage_user`, ya acotada a la subcuenta y con el super-admin de plataforma) lee y
-- escribe. Nadie más. Las rutas de servidor con service-role no pasan por RLS.
--
-- Marcha atrás: DROP TABLE public.user_private; (los datos siguen intactos en `users` hasta el paso (c)).

CREATE TABLE IF NOT EXISTS public.user_private (
  user_id           UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  base_salary       NUMERIC(12,2),
  fijo_unlock_type  TEXT NOT NULL DEFAULT 'sales',
  fijo_min_sales    INTEGER NOT NULL DEFAULT 0,
  fijo_min_revenue  NUMERIC NOT NULL DEFAULT 0,
  monthly_goal      NUMERIC(12,2),
  dni               TEXT,
  address           TEXT,
  personal_email    TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.user_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_private FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_private TO authenticated;

DROP POLICY IF EXISTS user_private_select ON public.user_private;
CREATE POLICY user_private_select ON public.user_private FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR (SELECT public.auth_can_manage_user(user_id)));

DROP POLICY IF EXISTS user_private_insert ON public.user_private;
CREATE POLICY user_private_insert ON public.user_private FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.auth_can_manage_user(user_id)));

DROP POLICY IF EXISTS user_private_update ON public.user_private;
CREATE POLICY user_private_update ON public.user_private FOR UPDATE TO authenticated
  USING ((SELECT public.auth_can_manage_user(user_id)))
  WITH CHECK ((SELECT public.auth_can_manage_user(user_id)));

-- Copia de los datos actuales (idempotente: no pisa lo que ya esté en `user_private`).
INSERT INTO public.user_private (user_id, base_salary, fijo_unlock_type, fijo_min_sales, fijo_min_revenue, monthly_goal, dni, address, personal_email)
SELECT id, base_salary, fijo_unlock_type, fijo_min_sales, fijo_min_revenue, monthly_goal, dni, address, personal_email
FROM public.users
ON CONFLICT (user_id) DO NOTHING;
