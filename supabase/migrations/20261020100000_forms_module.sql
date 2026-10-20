-- Módulo de Formularios (Marketing): formularios conversacionales para captación/cualificación de
-- clientes y empleados y feedback de alumnos.
--
-- Diseño:
--  · `forms` es el borrador editable; `form_versions` es una foto INMUTABLE de lo publicado. Las
--    respuestas apuntan a su versión, así que editar un formulario publicado no corrompe datos.
--  · Los envíos públicos NUNCA entran por RLS anónima: los escribe una ruta de servidor (service
--    role) que resuelve el tenant por slug. Aquí `anon` no tiene ningún permiso.
--  · Las respuestas contienen PII (y candidaturas de empleados): la lectura se limita por rol, no
--    basta con ser miembro de la subcuenta.
--  · `form_sessions` guarda UNA fila por sesión (no por evento) para proteger el tamaño de la BD en
--    Supabase Free (docs/FREE_TIER_OPERATIONS.md).
--  · Helpers de auth envueltos en `(select …)` para que Postgres los evalúe una vez (InitPlan).

-- ── forms ──────────────────────────────────────────────────────────────────────────────────────
create table public.forms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 80),
  name text not null check (char_length(name) between 1 and 160),
  category text not null default 'otro' check (category in (
    'cualificacion_cliente', 'captacion', 'empleado_setter', 'empleado_closer',
    'empleado_media_buyer', 'feedback_clase', 'feedback_modulo', 'feedback_cliente', 'otro')),
  audience text not null default 'captacion' check (audience in ('captacion', 'cualificacion', 'empleados', 'alumnos')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  draft_config jsonb not null,
  published_version_id uuid,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, slug)
);

-- ── form_versions (inmutables) ─────────────────────────────────────────────────────────────────
create table public.form_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  form_id uuid not null,
  version integer not null check (version > 0),
  config jsonb not null,
  published_by uuid references public.users(id) on delete set null,
  published_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (form_id, version),
  foreign key (tenant_id, form_id) references public.forms (tenant_id, id) on delete cascade
);

alter table public.forms
  add constraint forms_published_version_fk
  foreign key (tenant_id, published_version_id) references public.form_versions (tenant_id, id)
  on delete set null (published_version_id);

-- ── form_responses ─────────────────────────────────────────────────────────────────────────────
create table public.form_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  form_id uuid not null,
  version_id uuid not null,
  submission_id uuid not null,
  status text not null default 'partial' check (status in ('partial', 'completed')),
  answers jsonb not null default '{}'::jsonb,
  hidden jsonb not null default '{}'::jsonb,
  score integer check (score is null or score between 0 and 100),
  temperature text check (temperature is null or temperature in ('caliente', 'templado', 'frio')),
  tags text[] not null default '{}',
  rating smallint check (rating is null or rating between 1 and 10),
  nps smallint check (nps is null or nps between 0 and 10),
  teacher text,
  module text,
  class_name text,
  outcome text,
  variant text check (variant is null or variant in ('A', 'B')),
  contact_id uuid references public.contacts(id) on delete set null,
  review_status text not null default 'nuevo' check (review_status in ('nuevo', 'contactado', 'entrevista', 'descartado', 'contratado')),
  review_notes text,
  device text check (device is null or device in ('mobile', 'desktop')),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  ip_hash text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (tenant_id, submission_id),
  foreign key (tenant_id, form_id) references public.forms (tenant_id, id) on delete cascade,
  foreign key (tenant_id, version_id) references public.form_versions (tenant_id, id) on delete restrict
);

-- ── form_sessions (analítica: una fila por sesión) ─────────────────────────────────────────────
create table public.form_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  form_id uuid not null,
  version_id uuid,
  session_id uuid not null,
  status text not null default 'viewed' check (status in ('viewed', 'started', 'completed', 'abandoned')),
  device text check (device is null or device in ('mobile', 'desktop')),
  variant text check (variant is null or variant in ('A', 'B')),
  utm jsonb not null default '{}'::jsonb,
  referrer_host text,
  last_question text,
  max_question_index integer not null default 0 check (max_question_index >= 0),
  question_times jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  unique (tenant_id, session_id),
  foreign key (tenant_id, form_id) references public.forms (tenant_id, id) on delete cascade
);

-- ── webhooks salientes ─────────────────────────────────────────────────────────────────────────
create table public.form_webhooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  form_id uuid not null,
  url text not null check (url ~* '^https://' and char_length(url) <= 2000),
  -- Cifrado en la aplicación (misma clave que integration_settings); nunca en claro.
  secret_enc text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, form_id) references public.forms (tenant_id, id) on delete cascade
);

create table public.form_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  webhook_id uuid not null,
  response_id uuid not null references public.form_responses(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_status_code integer,
  last_error text,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique (webhook_id, response_id),
  foreign key (tenant_id, webhook_id) references public.form_webhooks (tenant_id, id) on delete cascade
);

-- ── índices (cada FK + las consultas del panel) ────────────────────────────────────────────────
create index forms_tenant_status_idx on public.forms (tenant_id, status, updated_at desc);
create index forms_published_version_idx on public.forms (tenant_id, published_version_id);
create index forms_created_by_idx on public.forms (created_by);
create index form_versions_form_idx on public.form_versions (tenant_id, form_id, version desc);
create index form_versions_published_by_idx on public.form_versions (published_by);
create index form_responses_form_created_idx on public.form_responses (tenant_id, form_id, created_at desc);
create index form_responses_version_idx on public.form_responses (tenant_id, version_id);
create index form_responses_contact_idx on public.form_responses (contact_id) where contact_id is not null;
create index form_responses_teacher_idx on public.form_responses (tenant_id, teacher, created_at desc) where teacher is not null;
create index form_responses_completed_idx on public.form_responses (tenant_id, form_id, completed_at desc) where status = 'completed';
create index form_sessions_form_created_idx on public.form_sessions (tenant_id, form_id, created_at desc);
create index form_webhooks_form_idx on public.form_webhooks (tenant_id, form_id);
create index form_webhook_deliveries_pending_idx on public.form_webhook_deliveries (next_attempt_at) where status = 'pending';
create index form_webhook_deliveries_response_idx on public.form_webhook_deliveries (response_id);
create index form_webhook_deliveries_webhook_idx on public.form_webhook_deliveries (tenant_id, webhook_id);

create trigger forms_updated_at before update on public.forms
  for each row execute function public.handle_updated_at();
create trigger form_responses_updated_at before update on public.form_responses
  for each row execute function public.handle_updated_at();

-- ── RLS ────────────────────────────────────────────────────────────────────────────────────────
alter table public.forms enable row level security;
alter table public.form_versions enable row level security;
alter table public.form_responses enable row level security;
alter table public.form_sessions enable row level security;
alter table public.form_webhooks enable row level security;
alter table public.form_webhook_deliveries enable row level security;

revoke all on public.forms, public.form_versions, public.form_responses, public.form_sessions,
  public.form_webhooks, public.form_webhook_deliveries from public, anon;
grant select, insert, update, delete on public.forms, public.form_versions, public.form_responses,
  public.form_sessions, public.form_webhook_deliveries to authenticated;
-- form_webhooks: el navegador no necesita (ni debe poder leer) el secreto cifrado. Privilegio de
-- SELECT por columnas en vez de revocar una columna sobre un grant de tabla (eso no funciona).
grant select (id, tenant_id, form_id, url, active, created_at) on public.form_webhooks to authenticated;
grant insert, update, delete on public.form_webhooks to authenticated;

-- Aislamiento por subcuenta, restrictivo (se suma a las policies de rol de abajo).
create policy "forms_tenant_isolation" on public.forms as restrictive for all to authenticated
  using (tenant_id in (select public.auth_tenant_ids()) or (select public.is_super_admin()))
  with check (tenant_id in (select public.auth_tenant_ids()) or (select public.is_super_admin()));
create policy "form_versions_tenant_isolation" on public.form_versions as restrictive for all to authenticated
  using (tenant_id in (select public.auth_tenant_ids()) or (select public.is_super_admin()))
  with check (tenant_id in (select public.auth_tenant_ids()) or (select public.is_super_admin()));
create policy "form_responses_tenant_isolation" on public.form_responses as restrictive for all to authenticated
  using (tenant_id in (select public.auth_tenant_ids()) or (select public.is_super_admin()))
  with check (tenant_id in (select public.auth_tenant_ids()) or (select public.is_super_admin()));
create policy "form_sessions_tenant_isolation" on public.form_sessions as restrictive for all to authenticated
  using (tenant_id in (select public.auth_tenant_ids()) or (select public.is_super_admin()))
  with check (tenant_id in (select public.auth_tenant_ids()) or (select public.is_super_admin()));
create policy "form_webhooks_tenant_isolation" on public.form_webhooks as restrictive for all to authenticated
  using (tenant_id in (select public.auth_tenant_ids()) or (select public.is_super_admin()))
  with check (tenant_id in (select public.auth_tenant_ids()) or (select public.is_super_admin()));
create policy "form_webhook_deliveries_tenant_isolation" on public.form_webhook_deliveries as restrictive for all to authenticated
  using (tenant_id in (select public.auth_tenant_ids()) or (select public.is_super_admin()))
  with check (tenant_id in (select public.auth_tenant_ids()) or (select public.is_super_admin()));

-- Roles de rol funcional. Quien crea/edita formularios: administración y marketing. Quien lee
-- respuestas: además manager y csm (feedback de alumnos). Los webhooks llevan secreto: solo
-- administración. Los envíos públicos NO pasan por aquí (los escribe el servidor).
create policy "forms_select_roles" on public.forms for select to authenticated
  using ((select public.get_my_role()) in ('admin', 'director', 'manager', 'marketing', 'csm'));
create policy "forms_write_roles" on public.forms for all to authenticated
  using ((select public.get_my_role()) in ('admin', 'director', 'marketing'))
  with check ((select public.get_my_role()) in ('admin', 'director', 'marketing'));

create policy "form_versions_select_roles" on public.form_versions for select to authenticated
  using ((select public.get_my_role()) in ('admin', 'director', 'manager', 'marketing', 'csm'));
create policy "form_versions_insert_roles" on public.form_versions for insert to authenticated
  with check ((select public.get_my_role()) in ('admin', 'director', 'marketing'));
-- Sin policy de update/delete en form_versions: son inmutables.

create policy "form_responses_select_roles" on public.form_responses for select to authenticated
  using ((select public.get_my_role()) in ('admin', 'director', 'manager', 'marketing', 'csm'));
create policy "form_responses_update_roles" on public.form_responses for update to authenticated
  using ((select public.get_my_role()) in ('admin', 'director', 'manager', 'marketing'))
  with check ((select public.get_my_role()) in ('admin', 'director', 'manager', 'marketing'));
create policy "form_responses_delete_roles" on public.form_responses for delete to authenticated
  using ((select public.get_my_role()) in ('admin', 'director'));

create policy "form_sessions_select_roles" on public.form_sessions for select to authenticated
  using ((select public.get_my_role()) in ('admin', 'director', 'manager', 'marketing', 'csm'));

create policy "form_webhooks_admin" on public.form_webhooks for all to authenticated
  using ((select public.get_my_role()) in ('admin', 'director'))
  with check ((select public.get_my_role()) in ('admin', 'director'));
create policy "form_webhook_deliveries_select_admin" on public.form_webhook_deliveries for select to authenticated
  using ((select public.get_my_role()) in ('admin', 'director'));

comment on table public.forms is 'Formularios conversacionales (borrador editable). Lo publicado vive en form_versions.';
comment on table public.form_versions is 'Foto inmutable de una publicación. Sin update/delete por RLS.';
comment on table public.form_responses is 'Envíos. Los escribe solo el servidor (service role); PII: lectura limitada por rol.';
comment on table public.form_sessions is 'Analítica por sesión (una fila por sesión, no por evento).';
