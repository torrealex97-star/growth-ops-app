-- Notas privadas del equipo sobre una conversación (patrón Chatwoot, módulo Conversaciones).
--
-- Las notas son SOLO internas: nunca se envían al lead ni entran en los mensajes. La lectura va por
-- RLS (solo roles de gestión) y TODA escritura pasa por la ruta de servidor
-- (`/conversaciones/[id]/notas`), igual que el resto del módulo: las tablas no admiten escritura
-- directa de authenticated. Borrar una conversación borra sus notas (FK en cascada).
-- Helpers de auth envueltos en `(select …)` para que Postgres los evalúe una vez (InitPlan).
-- Los comentarios `@` sobre compañeros no llevan metadatos propios: viven en el texto.

create table public.conversation_notes (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  conversation_id   uuid not null references public.conversations(id) on delete cascade,
  author_user_id    uuid references public.users(id) on delete set null,
  body              text not null check (char_length(btrim(body)) between 1 and 2000),
  pinned            boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index conversation_notes_conv_idx on public.conversation_notes (conversation_id, created_at);

alter table public.conversation_notes enable row level security;

-- Aislamiento por subcuenta, RESTRICTIVO (igual que el resto de tablas del módulo).
create policy "conversation_notes_tenant_isolation" on public.conversation_notes as restrictive for all to authenticated
  using ((tenant_id in (select public.auth_tenant_ids())) or (select public.is_super_admin()))
  with check ((tenant_id in (select public.auth_tenant_ids())) or (select public.is_super_admin()));

-- Lectura solo para quien trabaja las conversaciones (NOT el full team de mensajes: una nota puede
-- ser una opinión interna sobre el setter/closer que la lee).
create policy "conversation_notes_select_roles" on public.conversation_notes for select to authenticated
  using ((select public.get_my_role()) in ('admin', 'director', 'manager', 'marketing', 'setter'));

revoke insert, update, delete on public.conversation_notes from authenticated;
revoke all on public.conversation_notes from anon;
