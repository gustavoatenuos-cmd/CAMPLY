-- Prevent silent last-write-wins data loss when multiple tabs or devices save.

alter table public.camply_workspace
add column if not exists version bigint not null default 1;

create or replace function public.save_camply_workspace(
  p_data jsonb,
  p_expected_version bigint default null
)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_version bigint;
  current_user_id text := auth.uid()::text;
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Unauthorized' using errcode = '42501';
  end if;

  if p_expected_version is null then
    insert into public.camply_workspace (id, data, version, updated_at)
    values (current_user_id, p_data, 1, now())
    on conflict (id) do nothing
    returning version into next_version;
  else
    update public.camply_workspace
    set data = p_data,
        version = version + 1,
        updated_at = now()
    where id = current_user_id
      and version = p_expected_version
    returning version into next_version;
  end if;

  if next_version is null then
    raise exception 'Workspace changed in another session. Reload before saving.'
      using errcode = '40001';
  end if;

  return next_version;
end;
$$;

revoke all on function public.save_camply_workspace(jsonb, bigint) from public;
grant execute on function public.save_camply_workspace(jsonb, bigint) to authenticated;
