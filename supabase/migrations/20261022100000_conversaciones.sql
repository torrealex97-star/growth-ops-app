-- Conversaciones de leads (bandeja unificada). NO aplicada en producción: requiere confirmación del dueño.
--
-- Hasta ahora las conversaciones eran un snapshot JSON efímero en `integration_settings` (tope 300), sin
-- historial, sin métricas reales y sin sitio donde colgar a un agente de IA. Este módulo las persiste:
--   · `conversations`: una fila por conversación de un canal (GHL → Instagram, Facebook, WhatsApp, SMS, TikTok…).
--   · `conversation_messages`: mensajes, idempotentes por (tenant, external_id).
--   · `conversation_events`: auditoría de cambios de estado, asignaciones, traspasos y envíos.
-- Los mensajes contienen datos personales: la lectura se limita a quien trabaja con leads (no a cualquier
-- miembro de la subcuenta) y las escrituras van por rutas de servidor (service role).
-- Helpers de auth envueltos en `(select …)` para que Postgres los evalúe una vez (InitPlan).

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  external_id text not null,
  source text not null default 'ghl' check (source in ('ghl', 'meta', 'manual')),
  channel text not null default 'chat',
  contact_id uuid references public.contacts(id) on delete set null,
  contact_external_id text,
  status text not null default 'abierta' check (status in ('abierta', 'pendiente', 'aplazada', 'resuelta')),
  snoozed_until timestamptz,
  assignee_id uuid references public.users(id) on delete set null,
  ai_mode text not null default 'off' check (ai_mode in ('off', 'borrador', 'autonomo')),
  labels text[] not null default '{}',
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  first_reply_at timestamptz,
  unread_count integer not null default 0 check (unread_count >= 0),
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, source, external_id)
);
create index conversations_tenant_estado_idx on public.conversations (tenant_id, status, last_message_at desc);
create index conversations_tenant_contacto_idx on public.conversations (tenant_id, contact_id);

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  external_id text not null,
  direction text not null check (direction in ('entrante', 'saliente')),
  author text not null check (author in ('lead', 'humano', 'ia', 'sistema')),
  body text not null default '',
  sent_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, external_id)
);
create index conversation_messages_conv_idx on public.conversation_messages (conversation_id, sent_at);

create table public.conversation_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  kind text not null check (char_length(kind) between 1 and 60),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index conversation_events_conv_idx on public.conversation_events (conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.conversation_events enable row level security;

-- Aislamiento por subcuenta, RESTRICTIVO (igual que el resto de tablas).
create policy "conversations_tenant_isolation" on public.conversations as restrictive for all to authenticated
  using ((tenant_id in (select public.auth_tenant_ids())) or (select public.is_super_admin()))
  with check ((tenant_id in (select public.auth_tenant_ids())) or (select public.is_super_admin()));
create policy "conversation_messages_tenant_isolation" on public.conversation_messages as restrictive for all to authenticated
  using ((tenant_id in (select public.auth_tenant_ids())) or (select public.is_super_admin()))
  with check ((tenant_id in (select public.auth_tenant_ids())) or (select public.is_super_admin()));
create policy "conversation_events_tenant_isolation" on public.conversation_events as restrictive for all to authenticated
  using ((tenant_id in (select public.auth_tenant_ids())) or (select public.is_super_admin()))
  with check ((tenant_id in (select public.auth_tenant_ids())) or (select public.is_super_admin()));

-- Lectura: liderazgo, ventas y marketing. Sin permisos de escritura directa: todo va por la API (service role).
create policy "conversations_select_roles" on public.conversations for select to authenticated
  using ((select public.get_my_role()) in ('admin', 'director', 'manager', 'marketing', 'setter', 'closer', 'cold_caller'));
create policy "conversation_messages_select_roles" on public.conversation_messages for select to authenticated
  using ((select public.get_my_role()) in ('admin', 'director', 'manager', 'marketing', 'setter', 'closer', 'cold_caller'));
create policy "conversation_events_select_roles" on public.conversation_events for select to authenticated
  using ((select public.get_my_role()) in ('admin', 'director', 'manager', 'marketing', 'setter', 'closer', 'cold_caller'));

revoke insert, update, delete on public.conversations, public.conversation_messages, public.conversation_events from authenticated;
revoke all on public.conversations, public.conversation_messages, public.conversation_events from anon;
