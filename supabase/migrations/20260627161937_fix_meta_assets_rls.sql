-- MVP Policy to allow frontend to read meta_assets
create policy "Camply MVP read meta_assets"
on public.meta_assets
for select
to anon, authenticated
using (true);
