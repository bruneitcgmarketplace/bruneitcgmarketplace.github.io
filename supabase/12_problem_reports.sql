-- "Report a problem": users send a report (text + optional attachments) from the Account menu; admins read and manage them.
-- Attachments live in the private 'problem-files' bucket (see 13_problem_files_storage.sql), under <uid>/...
create table public.problem_reports (
  id          bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  category    text not null check (category in ('bug', 'deal', 'account', 'idea', 'other')),
  message     text not null check (char_length(message) between 5 and 2000),
  device      text check (char_length(device) <= 300),
  files       jsonb not null default '[]'::jsonb,           -- [{path, name, type, size}] max 3
  status      text not null default 'open' check (status in ('open', 'working', 'resolved')),
  admin_note  text check (char_length(admin_note) <= 1000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);
create index problem_reports_status_idx on public.problem_reports (status, created_at desc);
create index problem_reports_reporter_idx on public.problem_reports (reporter_id, created_at desc);

alter table public.problem_reports enable row level security;
-- reporters see their own reports; admins see all. Nobody writes the table directly: only the two functions below do.
create policy problems_read on public.problem_reports for select using (reporter_id = auth.uid() or public.is_admin(auth.uid()));
revoke insert, update, delete on public.problem_reports from anon, authenticated;

create or replace function public.submit_problem(p_category text, p_message text, p_device text default null, p_files jsonb default '[]'::jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); f jsonb; new_id bigint; msg text := btrim(coalesce(p_message, ''));
begin
  if p_category is null or p_category not in ('bug', 'deal', 'account', 'idea', 'other') then raise exception 'Choose a category'; end if;
  if char_length(msg) < 5 then raise exception 'Please describe the problem (at least 5 characters)'; end if;
  if char_length(msg) > 2000 then raise exception 'Message is too long (max 2000 characters)'; end if;
  if (select count(*) from problem_reports where reporter_id = me and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Too many reports today. Please try again tomorrow or contact the admin on WhatsApp';
  end if;
  p_files := coalesce(p_files, '[]'::jsonb);
  if jsonb_typeof(p_files) <> 'array' or jsonb_array_length(p_files) > 3 then raise exception 'You can attach up to 3 files'; end if;
  for f in select * from jsonb_array_elements(p_files) loop
    if jsonb_typeof(f) <> 'object' or coalesce(f->>'path', '') !~ ('^' || me::text || '/[A-Za-z0-9._-]{1,120}$') or char_length(coalesce(f->>'name', '')) not between 1 and 120 then
      raise exception 'Invalid attachment';
    end if;
  end loop;
  insert into problem_reports(reporter_id, category, message, device, files)
  values (me, p_category, msg, left(p_device, 300),
          (select coalesce(jsonb_agg(jsonb_build_object('path', e->>'path', 'name', e->>'name', 'type', left(coalesce(e->>'type', ''), 80), 'size', coalesce((e->>'size')::bigint, 0))), '[]'::jsonb) from jsonb_array_elements(p_files) e))
  returning id into new_id;
  return new_id;
end $$;

create or replace function public.admin_update_problem(p_id bigint, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(require_user()) then raise exception 'Admin only'; end if;
  if p_status not in ('open', 'working', 'resolved') then raise exception 'Invalid status'; end if;
  update problem_reports set status = p_status, admin_note = nullif(btrim(coalesce(p_note, '')), ''), updated_at = now() where id = p_id;
  if not found then raise exception 'Report not found'; end if;
end $$;
