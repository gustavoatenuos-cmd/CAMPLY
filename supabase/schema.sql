-- Camply MVP persistence
-- Run this file in the Supabase SQL Editor before using remote sync.

create table if not exists public.camply_workspace (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.camply_workspace enable row level security;

drop policy if exists "Camply MVP read workspace" on public.camply_workspace;
drop policy if exists "Camply MVP write workspace" on public.camply_workspace;

-- MVP single-user policy.
-- The current app still uses a local password gate, so this policy allows the
-- publishable key to read/write the single workspace row. Replace this with
-- authenticated user policies when Supabase Auth is added.
create policy "Camply MVP read workspace"
on public.camply_workspace
for select
to anon, authenticated
using (id = 'gustavo-camply');

create policy "Camply MVP write workspace"
on public.camply_workspace
for all
to anon, authenticated
using (id = 'gustavo-camply')
with check (id = 'gustavo-camply');

create index if not exists camply_workspace_updated_at_idx
on public.camply_workspace (updated_at desc);
