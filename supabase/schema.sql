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

create policy "Permanent users can manage their own workspace"
on public.camply_workspace
for all
to authenticated
using (
  id = auth.uid()::text
  and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
)
with check (
  id = auth.uid()::text
  and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
);

create index if not exists camply_workspace_updated_at_idx
on public.camply_workspace (updated_at desc);
