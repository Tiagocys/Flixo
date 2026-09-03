create table if not exists public.video_jobs (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  prompt text not null,
  settings jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  current_step text not null default 'queued',
  progress integer not null default 0,
  backend_provider text not null default 'moneyprinterturbo',
  backend_task_id text,
  script text,
  narration_key text,
  subtitles_key text,
  video_key text,
  asset_manifest jsonb not null default '{}'::jsonb,
  timeline jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.video_jobs
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists video_jobs_created_at_idx
  on public.video_jobs (created_at desc);

create index if not exists video_jobs_status_idx
  on public.video_jobs (status);

create index if not exists video_jobs_user_id_created_at_idx
  on public.video_jobs (user_id, created_at desc);

create table if not exists public.media_assets (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  type text not null check (type in ('video', 'audio', 'image')),
  provider text not null,
  title text not null,
  prompt text,
  asset_key text,
  asset_url text,
  duration numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.media_assets
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists media_assets_created_at_idx
  on public.media_assets (created_at desc);

create index if not exists media_assets_type_idx
  on public.media_assets (type);

create index if not exists media_assets_provider_idx
  on public.media_assets (provider);

create index if not exists media_assets_user_id_created_at_idx
  on public.media_assets (user_id, created_at desc);

create table if not exists public.clipper_projects (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade,
  status text not null default 'queued',
  current_step text not null default 'queued',
  progress integer not null default 0,
  title text not null default 'Projeto de clipes',
  source_url text,
  original_name text,
  candidates_count integer not null default 0,
  outputs_count integer not null default 0,
  r2_outputs_count integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.clipper_projects
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.clipper_projects
  add column if not exists source_url text;

alter table public.clipper_projects
  add column if not exists original_name text;

alter table public.clipper_projects
  add column if not exists candidates_count integer not null default 0;

alter table public.clipper_projects
  add column if not exists outputs_count integer not null default 0;

alter table public.clipper_projects
  add column if not exists r2_outputs_count integer not null default 0;

alter table public.clipper_projects
  add column if not exists data jsonb not null default '{}'::jsonb;

create index if not exists clipper_projects_user_id_updated_at_idx
  on public.clipper_projects (user_id, updated_at desc);

create index if not exists clipper_projects_status_idx
  on public.clipper_projects (status);

alter table public.video_jobs enable row level security;
alter table public.media_assets enable row level security;
alter table public.clipper_projects enable row level security;

drop policy if exists "Users can read own video jobs" on public.video_jobs;
create policy "Users can read own video jobs"
  on public.video_jobs for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own video jobs" on public.video_jobs;
create policy "Users can insert own video jobs"
  on public.video_jobs for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own video jobs" on public.video_jobs;
create policy "Users can update own video jobs"
  on public.video_jobs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can read own media assets" on public.media_assets;
create policy "Users can read own media assets"
  on public.media_assets for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own media assets" on public.media_assets;
create policy "Users can insert own media assets"
  on public.media_assets for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can read own clipper projects" on public.clipper_projects;
create policy "Users can read own clipper projects"
  on public.clipper_projects for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own clipper projects" on public.clipper_projects;
create policy "Users can insert own clipper projects"
  on public.clipper_projects for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own clipper projects" on public.clipper_projects;
create policy "Users can update own clipper projects"
  on public.clipper_projects for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.billing_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  status text not null default 'free',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_customers_stripe_customer_id_idx
  on public.billing_customers (stripe_customer_id);

create index if not exists billing_customers_status_idx
  on public.billing_customers (status);

create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists stripe_events_type_received_at_idx
  on public.stripe_events (type, received_at desc);

alter table public.billing_customers enable row level security;
alter table public.stripe_events enable row level security;

drop policy if exists "Users can read own billing status" on public.billing_customers;
create policy "Users can read own billing status"
  on public.billing_customers for select
  using (auth.uid() = user_id);

drop policy if exists "Users can update own billing email" on public.billing_customers;
create policy "Users can update own billing email"
  on public.billing_customers for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
