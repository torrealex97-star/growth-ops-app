-- SONDA DE AISLAMIENTO ENTRE SUBCUENTAS (solo lectura; se revierte sola).
--
-- Qué hace: por cada subcuenta que tiene un miembro NORMAL (no super-admin y de una sola subcuenta), simula su sesión
-- (rol `authenticated` + su uid) y cuenta, en TODAS las tablas con `tenant_id`, cuántas filas de OTRAS subcuentas puede
-- ver, más las personas de `users` que no comparten ninguna subcuenta con él. El resultado esperado es `tablas_con_FUGA=0`
-- en todas las sesiones. Termina con un RAISE EXCEPTION para que Postgres revierta la transacción entera: no deja nada.
--
-- Cómo ejecutarla: SQL Editor de Supabase (o execute_sql). El mensaje de error EXPERADO contiene el resumen.
--
-- LÍMITE (importante): esta sonda solo detecta fugas donde YA hay filas ajenas. Un hueco en una política puede existir sin
-- que el contador lo muestre. Por eso se completa con la comprobación ESTRUCTURAL de más abajo y con
-- tests/aislamiento-cierre-tenant.test.mjs (toda tabla con tenant_id debe estar registrada y revisada).

DO $t$
DECLARE
  par record; tb record; n bigint; propias bigint; res text := ''; total_tablas int := 0; sin_acceso int := 0; fugas int := 0; linea text;
BEGIN
  FOR par IN
    SELECT DISTINCT ON (tm.tenant_id) tm.tenant_id, tm.user_id
    FROM public.tenant_members tm
    WHERE tm.role <> 'super_admin'
      AND NOT EXISTS (SELECT 1 FROM public.tenant_members x WHERE x.user_id = tm.user_id AND x.role = 'super_admin')
      AND (SELECT count(*) FROM public.tenant_members y WHERE y.user_id = tm.user_id) = 1
    ORDER BY tm.tenant_id
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', par.user_id, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    linea := ''; propias := 0; total_tablas := 0; sin_acceso := 0; fugas := 0;
    FOR tb IN
      SELECT c.table_name FROM information_schema.columns c
      JOIN pg_tables p ON p.schemaname = 'public' AND p.tablename = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' ORDER BY 1
    LOOP
      total_tablas := total_tablas + 1;
      BEGIN
        EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id <> ALL (ARRAY(SELECT public.auth_tenant_ids()))', tb.table_name) INTO n;
        IF n > 0 THEN linea := linea || tb.table_name || '=' || n || ' '; fugas := fugas + 1; END IF;
        EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id = ANY (ARRAY(SELECT public.auth_tenant_ids()))', tb.table_name) INTO n;
        propias := propias + n;
      EXCEPTION WHEN insufficient_privilege THEN sin_acceso := sin_acceso + 1;
      END;
    END LOOP;
    BEGIN
      SELECT count(*) INTO n FROM public.users u WHERE u.id <> par.user_id
        AND NOT EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.user_id = u.id AND m.tenant_id IN (SELECT public.auth_tenant_ids()));
      IF n > 0 THEN linea := linea || 'users(ajenos)=' || n || ' '; fugas := fugas + 1; END IF;
    EXCEPTION WHEN insufficient_privilege THEN sin_acceso := sin_acceso + 1; END;
    RESET ROLE;
    res := res || format('[sesión de miembro normal · tablas_con_tenant=%s · con_permiso_denegado=%s · filas_PROPIAS_visibles=%s · tablas_con_FUGA=%s · detalle_fugas: %s] ', total_tablas, sin_acceso, propias, fugas, COALESCE(NULLIF(linea,''),'ninguna'));
  END LOOP;
  RAISE EXCEPTION 'AISLAMIENTO %', res;
END $t$;

-- COMPROBACIÓN ESTRUCTURAL (independiente de los datos): tablas con tenant_id que NO tienen capa RESTRICTIVE por subcuenta y
-- cuyas políticas permisivas abren más de lo debido (`OR is_admin_or_director()` mira el rol funcional, no la subcuenta;
-- `true`; o sin referencia a tenant). Resultado esperado: 0 filas.
--
-- with t as (
--   select c.table_name as tabla from information_schema.columns c
--   join pg_tables p on p.schemaname='public' and p.tablename=c.table_name
--   where c.table_schema='public' and c.column_name='tenant_id'
-- ), estado as (
--   select t.tabla, pt.rowsecurity as rls,
--     exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename=t.tabla and p.permissive='RESTRICTIVE'
--            and (coalesce(p.qual,'')||coalesce(p.with_check,'')) ilike '%tenant%') as tiene_restrictiva_tenant,
--     exists(select 1 from pg_policies p where p.schemaname='public' and p.tablename=t.tabla and p.permissive='PERMISSIVE'
--            and ((coalesce(p.qual,'')||coalesce(p.with_check,'')) ilike '%is_admin_or_director()%'
--              or p.qual='true' or p.with_check='true'
--              or ((coalesce(p.qual,'')||coalesce(p.with_check,'')) not ilike '%tenant%' and (coalesce(p.qual,'')||coalesce(p.with_check,'')) not ilike '%super_admin%'))) as permisiva_abierta
--   from t join pg_tables pt on pt.schemaname='public' and pt.tablename=t.tabla
-- )
-- select * from estado where rls = false or (not tiene_restrictiva_tenant and permisiva_abierta) order by tabla;
