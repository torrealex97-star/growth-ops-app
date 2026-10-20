-- El rol csm (Customer Success) necesita ver el feedback de alumnos, pero NO las candidaturas de
-- empleados ni las cualificaciones de clientes: contienen PII de terceros ajenos a su trabajo.
-- Se estrecha su lectura a los formularios cuya audiencia es 'alumnos'. Los demás roles no cambian.
-- (La API de administración aplica la misma regla; esto es la defensa en profundidad de la BD.)

drop policy if exists "forms_select_roles" on public.forms;
create policy "forms_select_roles" on public.forms for select to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'director', 'manager', 'marketing')
    or ((select public.get_my_role()) = 'csm' and audience = 'alumnos')
  );

drop policy if exists "form_responses_select_roles" on public.form_responses;
create policy "form_responses_select_roles" on public.form_responses for select to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'director', 'manager', 'marketing')
    or (
      (select public.get_my_role()) = 'csm'
      and exists (
        select 1 from public.forms f
        where f.tenant_id = form_responses.tenant_id and f.id = form_responses.form_id and f.audience = 'alumnos'
      )
    )
  );

drop policy if exists "form_sessions_select_roles" on public.form_sessions;
create policy "form_sessions_select_roles" on public.form_sessions for select to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'director', 'manager', 'marketing')
    or (
      (select public.get_my_role()) = 'csm'
      and exists (
        select 1 from public.forms f
        where f.tenant_id = form_sessions.tenant_id and f.id = form_sessions.form_id and f.audience = 'alumnos'
      )
    )
  );

drop policy if exists "form_versions_select_roles" on public.form_versions;
create policy "form_versions_select_roles" on public.form_versions for select to authenticated
  using (
    (select public.get_my_role()) in ('admin', 'director', 'manager', 'marketing')
    or (
      (select public.get_my_role()) = 'csm'
      and exists (
        select 1 from public.forms f
        where f.tenant_id = form_versions.tenant_id and f.id = form_versions.form_id and f.audience = 'alumnos'
      )
    )
  );
