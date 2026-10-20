-- Formularios: la RLS no puede ser más permisiva que la API.
--  · borrar un formulario (y, en cascada, sus respuestas) solo admin/director, también por PostgREST;
--  · las respuestas son evidencia: manager/marketing solo cambian la revisión, no answers/score.
-- Las rutas de la app usan service-role y ya imponen esto; esto cierra el acceso directo.

drop policy if exists "forms_write_roles" on public.forms;
create policy "forms_insert_roles" on public.forms for insert to authenticated
  with check ((select public.get_my_role()) in ('admin', 'director', 'marketing'));
create policy "forms_update_roles" on public.forms for update to authenticated
  using ((select public.get_my_role()) in ('admin', 'director', 'marketing'))
  with check ((select public.get_my_role()) in ('admin', 'director', 'marketing'));
create policy "forms_delete_roles" on public.forms for delete to authenticated
  using ((select public.get_my_role()) in ('admin', 'director'));

revoke update on public.form_responses from authenticated;
grant update (review_status, review_notes) on public.form_responses to authenticated;
