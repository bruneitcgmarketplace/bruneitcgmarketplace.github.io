-- Admin tools: see all users' private fields, grant membership manually, reset strikes.

drop policy private_read_own on public.private_profiles;
create policy private_read_own on public.private_profiles for select
  using (id = auth.uid() or public.is_admin(auth.uid()));

create function public.admin_grant_membership(p_user uuid, p_days int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(require_user()) then raise exception 'Admin only'; end if;
  if p_days is null or p_days < -3650 or p_days > 3650 then raise exception 'Days out of range'; end if;
  update private_profiles
    set member_until = case when p_days <= 0 then now() else greatest(coalesce(member_until, now()), now()) + make_interval(days => p_days) end
    where id = p_user;
end $$;

create function public.admin_set_strikes(p_user uuid, p_strikes int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(require_user()) then raise exception 'Admin only'; end if;
  update private_profiles set strikes = greatest(0, least(coalesce(p_strikes, 0), 99)) where id = p_user;
end $$;
