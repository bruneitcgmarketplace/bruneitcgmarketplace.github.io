-- Testing period: membership plan paused, every user has all features (auction selling).
-- create_listing() calls is_member(), so redefining it opens the rule server-side.
-- To bring the plan back, re-apply the original is_member() from 01_schema.sql:
--   select coalesce((select member_until > now() from private_profiles where id = uid), false)
create or replace function public.is_member(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select true
$$;
