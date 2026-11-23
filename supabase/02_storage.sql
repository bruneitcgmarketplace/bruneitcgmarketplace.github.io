-- Public bucket for listing photos; users can only write inside their own folder (<uid>/...)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 1048576, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "photos public read" on storage.objects for select using (bucket_id = 'listing-photos');
create policy "photos upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
