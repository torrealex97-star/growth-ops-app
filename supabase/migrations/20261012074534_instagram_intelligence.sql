-- Instagram Intelligence extends the existing external-research pipeline.
-- It does not replace Meta's official API tables for the tenant's own account.

alter table public.social_research_jobs
  drop constraint if exists social_research_jobs_job_type_check;

alter table public.social_research_jobs
  add constraint social_research_jobs_job_type_check
  check (job_type in ('profile', 'reel', 'reels', 'posts', 'videos'));

alter table public.social_posts
  add column if not exists transcript text,
  add column if not exists transcript_timing text
    check (transcript_timing is null or transcript_timing in ('exact', 'estimated', 'none')),
  add column if not exists analysis_status text not null default 'not_analyzed'
    check (analysis_status in ('not_analyzed', 'ready', 'failed')),
  add column if not exists analysis_json jsonb,
  add column if not exists analyzed_at timestamptz,
  add column if not exists metrics_observed_at timestamptz;

create table if not exists public.social_post_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  post_id uuid not null references public.social_posts(id) on delete cascade,
  observed_at timestamptz not null default now(),
  views_count bigint check (views_count is null or views_count >= 0),
  likes_count bigint check (likes_count is null or likes_count >= 0),
  comments_count bigint check (comments_count is null or comments_count >= 0),
  shares_count bigint check (shares_count is null or shares_count >= 0),
  source text not null default 'apify',
  created_at timestamptz not null default now()
);

create index if not exists idx_social_metric_snapshots_tenant_post_observed
  on public.social_post_metric_snapshots (tenant_id, post_id, observed_at desc);

create index if not exists idx_social_posts_tenant_published_views
  on public.social_posts (tenant_id, published_at desc, views_count desc);

alter table public.social_post_metric_snapshots enable row level security;

drop policy if exists "social_metric_snapshots_select_tenant" on public.social_post_metric_snapshots;
create policy "social_metric_snapshots_select_tenant"
  on public.social_post_metric_snapshots for select
  to authenticated
  using (
    tenant_id in (select public.auth_tenant_ids())
    or (select public.is_super_admin())
  );

drop policy if exists "social_metric_snapshots_insert_manager" on public.social_post_metric_snapshots;
create policy "social_metric_snapshots_insert_manager"
  on public.social_post_metric_snapshots for insert
  to authenticated
  with check (
    (tenant_id in (select public.auth_tenant_ids()) and (select public.is_admin_or_director()))
    or (select public.is_super_admin())
  );

comment on table public.social_post_metric_snapshots is
  'Append-only metric observations for public third-party social posts. Null means not observed, never zero.';
