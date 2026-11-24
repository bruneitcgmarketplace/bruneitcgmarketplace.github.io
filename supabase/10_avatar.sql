-- Profile picture: set or clear my own avatar URL (profiles.avatar_url is not directly writable by users).
-- The URL must point into my own folder of the public 'avatars' bucket (see 11_avatar_storage.sql).
create or replace function public.set_avatar(p_url text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user();
begin
  if p_url is not null and (length(p_url) > 500 or position('/storage/v1/object/public/avatars/' || me::text || '/' in p_url) = 0 or p_url !~ '^https://') then
    raise exception 'Invalid avatar';
  end if;
  update profiles set avatar_url = p_url where id = me;
end $$;
