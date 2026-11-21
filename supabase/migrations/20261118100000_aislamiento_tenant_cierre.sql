-- ESTADO: NO APLICADA en producción. Pendiente de dry-run + confirmación expresa (CLAUDE.md).
--
-- CIERRE DE AISLAMIENTO ENTRE SUBCUENTAS (18-nov-2026). Idempotente.
--
-- Auditoría con la sonda `scripts/qa/sonda-aislamiento-rls.sql` (sesión de un miembro normal, no super-admin, que cuenta
-- filas de OTRAS subcuentas en las 125 tablas con `tenant_id`) y revisión estructural de políticas. Hallazgos reales:
--
--   1) 9 tablas con `tenant_id` sin capa restrictiva y con la cláusula `OR is_admin_or_director()`. Esa función mira el
--      rol FUNCIONAL de la persona (users.role_id), no la subcuenta: quien es Administrador o Director en UNA subcuenta
--      podía LEER, MODIFICAR y BORRAR esas tablas en TODAS. La sonda lo vio (social_posts 223 filas ajenas, etc.).
--      Tablas: email_events, email_messages, email_templates, social_post_metric_snapshots, social_posts,
--      social_profiles, social_raw_payloads, social_research_jobs, tenant_email_settings.
--   2) `resource_links` y `resource_link_divisions` (enlaces de «Recursos de venta») NO tenían subcuenta: cualquier usuario de
--      cualquier cliente los leía y cualquier admin/director de cualquier cliente los creaba, cambiaba o borraba para todos.
--   3) `roles` (catálogo GLOBAL de roles) podía modificarse por cualquier admin/director de cualquier cliente.
--
-- Qué NO cambia: el super-administrador de la plataforma conserva el acceso a todo (la capa restrictiva lo deja pasar);
-- las rutas de servidor con service-role no pasan por RLS; los miembros de una subcuenta siguen viendo la suya.
--
-- Los datos de las filas existentes de `resource_links` (2) se asignan a su subcuenta con un UPDATE de DATOS aparte (no va
-- aquí: es dato de una subcuenta concreta); mientras tengan `tenant_id` nulo la capa restrictiva las oculta a los miembros
-- normales (falla cerrado). El `SET NOT NULL` es condicional y se repite tras el backfill.
--
-- Marcha atrás: DROP POLICY de las `*_tenant_isolation` creadas aquí; recrear `rl_*`, `rld_*` y `roles_modify` con su
-- definición anterior (is_admin_or_director()).

-- 1) Capa RESTRICTIVE por subcuenta en las 9 tablas. Una política RESTRICTIVE se combina con AND con las permisivas, así
--    que el `OR is_admin_or_director()` de estas tablas deja de abrir otras subcuentas.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'email_events', 'email_messages', 'email_templates', 'social_post_metric_snapshots', 'social_posts',
    'social_profiles', 'social_raw_payloads', 'social_research_jobs', 'tenant_email_settings'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL '
      || 'USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin())) '
      || 'WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()))',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;

-- 2) Enlaces de Recursos de venta POR SUBCUENTA.
ALTER TABLE public.resource_link_divisions
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.resource_links
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS resource_link_divisions_tenant_idx ON public.resource_link_divisions (tenant_id);
CREATE INDEX IF NOT EXISTS resource_links_tenant_idx ON public.resource_links (tenant_id);

-- Permisivas: dentro de SU subcuenta, con la misma regla por rol que ya tenían.
DROP POLICY IF EXISTS rl_select ON public.resource_links;
CREATE POLICY rl_select ON public.resource_links FOR SELECT USING (
  (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()))
  AND (public.is_admin_or_director() OR cardinality(applies_to) = 0 OR public.get_my_role() = ANY (applies_to))
);
DROP POLICY IF EXISTS rl_modify ON public.resource_links;
CREATE POLICY rl_modify ON public.resource_links FOR ALL
  USING ((tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin())) AND public.is_admin_or_director())
  WITH CHECK ((tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin())) AND public.is_admin_or_director());

DROP POLICY IF EXISTS rld_select ON public.resource_link_divisions;
CREATE POLICY rld_select ON public.resource_link_divisions FOR SELECT USING (
  (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()))
  AND public.get_my_role() IS NOT NULL
);
DROP POLICY IF EXISTS rld_modify ON public.resource_link_divisions;
CREATE POLICY rld_modify ON public.resource_link_divisions FOR ALL
  USING ((tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin())) AND public.is_admin_or_director())
  WITH CHECK ((tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin())) AND public.is_admin_or_director());

-- Y la capa restrictiva, como en el resto de tablas con subcuenta.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['resource_links', 'resource_link_divisions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL '
      || 'USING (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin())) '
      || 'WITH CHECK (tenant_id IN (SELECT public.auth_tenant_ids()) OR (SELECT public.is_super_admin()))',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;

-- NOT NULL solo cuando ya no quedan filas sin subcuenta (se repite tras el backfill de datos).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.resource_links WHERE tenant_id IS NULL) THEN
    ALTER TABLE public.resource_links ALTER COLUMN tenant_id SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.resource_link_divisions WHERE tenant_id IS NULL) THEN
    ALTER TABLE public.resource_link_divisions ALTER COLUMN tenant_id SET NOT NULL;
  END IF;
END $$;

-- 3) `roles` es un catálogo GLOBAL: solo el super-administrador de la plataforma puede modificarlo. La lectura sigue abierta
--    (las claves de rol no son sensibles y las pantallas las necesitan). Ningún código de la app escribe en esta tabla.
DROP POLICY IF EXISTS roles_modify ON public.roles;
CREATE POLICY roles_modify ON public.roles FOR ALL
  USING ((SELECT public.is_super_admin()))
  WITH CHECK ((SELECT public.is_super_admin()));
