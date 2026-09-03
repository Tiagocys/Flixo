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
