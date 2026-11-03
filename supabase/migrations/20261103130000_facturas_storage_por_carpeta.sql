-- FACTURAS: cada persona solo toca SU carpeta; finanzas, toda la subcuenta.
--
-- Hasta ahora las políticas de Storage de los buckets `contratos` y `facturas` solo comprobaban la
-- SUBCUENTA (primera carpeta de la ruta): cualquier miembro, incluido un colaborador, podía listar, leer,
-- sustituir o borrar TODAS las facturas de la subcuenta (llevan NIF e IBAN de terceros). Mientras el bucket
-- estaba vacío era teórico; al subir los colaboradores sus facturas de comisiones deja de serlo.
--
-- Ruta de una factura de comisiones: <subcuenta>/comisiones/<persona>/<archivo>.
--   · `facturas`: finanzas (admin/director/manager, igual que la RLS de `expenses`) accede a toda la subcuenta;
--     el resto, solo a <subcuenta>/comisiones/<su id>/.
--   · `contratos`: sin cambios (política por subcuenta).
--
-- APLICADA en producción el 2026-11-03 (verificada antes en transacción revertida con la sesión de una
-- colaboradora y la de una administradora: 9/9 casos como se esperaba, 0 archivos afectados porque el bucket
-- estaba vacío). Si se re-aplica en otro entorno, es idempotente (DROP POLICY IF EXISTS + CREATE).
-- Marcha atrás: volver a crear las cuatro políticas con `bucket_id = ANY (ARRAY['contratos','facturas'])`
-- y solo la condición de subcuenta (ver 20260913100000_storage_tenant_policies.sql).

BEGIN;

DROP POLICY IF EXISTS tenant_files_select ON storage.objects;
DROP POLICY IF EXISTS tenant_files_insert ON storage.objects;
DROP POLICY IF EXISTS tenant_files_update ON storage.objects;
DROP POLICY IF EXISTS tenant_files_delete ON storage.objects;

CREATE POLICY tenant_files_select ON storage.objects FOR SELECT TO authenticated USING (
  (bucket_id = 'contratos' AND (
    (storage.foldername(name))[1] IN (SELECT (auth_tenant_ids())::text) OR is_super_admin()
  ))
  OR (bucket_id = 'facturas' AND (
    is_super_admin()
    OR ((storage.foldername(name))[1] IN (SELECT (auth_tenant_ids())::text) AND (
      get_my_role() IN ('admin', 'director', 'manager')
      OR ((storage.foldername(name))[2] = 'comisiones'
          AND (storage.foldername(name))[3] = (SELECT auth.uid())::text)
    ))
  ))
);

CREATE POLICY tenant_files_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  (bucket_id = 'contratos' AND (
    (storage.foldername(name))[1] IN (SELECT (auth_tenant_ids())::text) OR is_super_admin()
  ))
  OR (bucket_id = 'facturas' AND (
    is_super_admin()
    OR ((storage.foldername(name))[1] IN (SELECT (auth_tenant_ids())::text) AND (
      get_my_role() IN ('admin', 'director', 'manager')
      OR ((storage.foldername(name))[2] = 'comisiones'
          AND (storage.foldername(name))[3] = (SELECT auth.uid())::text)
    ))
  ))
);

CREATE POLICY tenant_files_update ON storage.objects FOR UPDATE TO authenticated USING (
  (bucket_id = 'contratos' AND (
    (storage.foldername(name))[1] IN (SELECT (auth_tenant_ids())::text) OR is_super_admin()
  ))
  OR (bucket_id = 'facturas' AND (
    is_super_admin()
    OR ((storage.foldername(name))[1] IN (SELECT (auth_tenant_ids())::text) AND (
      get_my_role() IN ('admin', 'director', 'manager')
      OR ((storage.foldername(name))[2] = 'comisiones'
          AND (storage.foldername(name))[3] = (SELECT auth.uid())::text)
    ))
  ))
) WITH CHECK (
  (bucket_id = 'contratos' AND (
    (storage.foldername(name))[1] IN (SELECT (auth_tenant_ids())::text) OR is_super_admin()
  ))
  OR (bucket_id = 'facturas' AND (
    is_super_admin()
    OR ((storage.foldername(name))[1] IN (SELECT (auth_tenant_ids())::text) AND (
      get_my_role() IN ('admin', 'director', 'manager')
      OR ((storage.foldername(name))[2] = 'comisiones'
          AND (storage.foldername(name))[3] = (SELECT auth.uid())::text)
    ))
  ))
);

CREATE POLICY tenant_files_delete ON storage.objects FOR DELETE TO authenticated USING (
  (bucket_id = 'contratos' AND (
    (storage.foldername(name))[1] IN (SELECT (auth_tenant_ids())::text) OR is_super_admin()
  ))
  OR (bucket_id = 'facturas' AND (
    is_super_admin()
    OR ((storage.foldername(name))[1] IN (SELECT (auth_tenant_ids())::text) AND (
      get_my_role() IN ('admin', 'director', 'manager')
      OR ((storage.foldername(name))[2] = 'comisiones'
          AND (storage.foldername(name))[3] = (SELECT auth.uid())::text)
    ))
  ))
);

COMMIT;
