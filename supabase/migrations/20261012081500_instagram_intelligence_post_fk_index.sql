-- Cover the post_id foreign key used by ON DELETE CASCADE independently of tenant filters.
-- The primary analytics index starts with tenant_id and cannot serve this lookup efficiently.

create index if not exists idx_social_metric_snapshots_post_id
  on public.social_post_metric_snapshots (post_id);
