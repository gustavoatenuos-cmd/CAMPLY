-- Security hardening: remove the public MVP workspace and require permanent users.

drop policy if exists "Camply MVP read workspace" on public.camply_workspace;
drop policy if exists "Camply MVP write workspace" on public.camply_workspace;
drop policy if exists "Users can manage their own workspace" on public.camply_workspace;

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

drop policy if exists "Users can manage their own integrations" on public.meta_integrations;
drop policy if exists "Users can manage assets for their integrations" on public.meta_assets;
drop policy if exists "Users can view sync logs for their integrations" on public.meta_sync_logs;
drop policy if exists "Users can manage their oauth states" on public.meta_oauth_states;

create policy "Permanent users can manage their own integrations"
on public.meta_integrations
for all
to authenticated
using (
  user_id = auth.uid()
  and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
)
with check (
  user_id = auth.uid()
  and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
);

create policy "Permanent users can manage assets for their integrations"
on public.meta_assets
for all
to authenticated
using (
  integration_id in (select id from public.meta_integrations where user_id = auth.uid())
  and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
)
with check (
  integration_id in (select id from public.meta_integrations where user_id = auth.uid())
  and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
);

create policy "Permanent users can view their sync logs"
on public.meta_sync_logs
for select
to authenticated
using (
  integration_id in (select id from public.meta_integrations where user_id = auth.uid())
  and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
);

create policy "Permanent users can manage their oauth states"
on public.meta_oauth_states
for all
to authenticated
using (
  user_id = auth.uid()
  and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
)
with check (
  user_id = auth.uid()
  and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
);

create index if not exists meta_integrations_user_status_idx
on public.meta_integrations (user_id, status);

create index if not exists meta_oauth_states_expires_at_idx
on public.meta_oauth_states (expires_at);
