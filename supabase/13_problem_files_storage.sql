-- Private bucket for report attachments (screenshots, PDFs, short screen recordings). Not public: only the reporter and admins can read.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('problem-files', 'problem-files', false, 10485760,
        array['image/jpeg','image/png','image/webp','application/pdf','text/plain','text/csv','video/mp4','video/quicktime'])
on conflict (id) do nothing;

create policy "problem files upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'problem-files' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "problem files read own or admin" on storage.objects for select to authenticated
  using (bucket_id = 'problem-files' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin(auth.uid())));
create policy "problem files delete admin" on storage.objects for delete to authenticated
  using (bucket_id = 'problem-files' and public.is_admin(auth.uid()));
