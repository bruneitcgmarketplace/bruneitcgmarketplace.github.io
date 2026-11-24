-- Admin moderation: suspend, ban, strike +/-, delete user, and an audit log.
-- Banned/suspended users can still browse, but every action (listing, buying, bidding, inventory, rating...) is refused
-- because they all go through require_user(). Admins are never blocked.

alter table public.private_profiles
  add column if not exists banned boolean not null default false,
  add column if not exists banned_reason text,
  add column if not exists suspended_until timestamptz,
  add column if not exists suspended_reason text;

create or replace function public.require_user() returns uuid language plpgsql stable as $$
declare me uuid := auth.uid(); pp private_profiles;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into pp from private_profiles where id = me;
  if found and not pp.is_admin then
    if pp.banned then
      raise exception 'Your account is banned%', coalesce(': ' || pp.banned_reason, '');
    end if;
    if pp.suspended_until is not null and pp.suspended_until > now() then
      raise exception 'Your account is suspended until %', to_char(pp.suspended_until at time zone 'Asia/Brunei', 'DD Mon YYYY HH24:MI') || coalesce(' (' || pp.suspended_reason || ')', '');
    end if;
  end if;
  return me;
end $$;

-- what admins did (kept even after a user is deleted, so no foreign key on user_id)
create table public.admin_actions (
  id bigint generated always as identity primary key,
  admin_id uuid,
  user_id uuid not null,
  user_name text,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);
alter table public.admin_actions enable row level security;
create policy admin_actions_read on public.admin_actions for select using (is_admin(auth.uid()));

create function public._admin_target(p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user();
begin
  if not is_admin(me) then raise exception 'Admin only'; end if;
  if p_user = me then raise exception 'You cannot do this to your own account'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'User not found'; end if;
  if is_admin(p_user) then raise exception 'Remove admin rights first: admins cannot be suspended, banned or deleted'; end if;
  return me;
end $$;

create function public._log_admin(p_admin uuid, p_user uuid, p_action text, p_detail text) returns void
language sql security definer set search_path = public as $$
  insert into admin_actions(admin_id, user_id, user_name, action, detail)
  values (p_admin, p_user, (select display_name from profiles where id = p_user), p_action, p_detail);
$$;

-- cancel what a blocked user still has on sale (auctions that already have bids are left to finish)
create function public._cancel_user_listings(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update listings set status = 'cancelled' where seller_id = p_user and status = 'active' and (type = 'buy_now' or coalesce(bid_count, 0) = 0);
  get diagnostics n = row_count; return n;
end $$;

-- strikes +1 / -1 (any whole number), kept between 0 and 99
create function public.admin_adjust_strikes(p_user uuid, p_delta int, p_reason text default null) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := _admin_target(p_user); s int;
begin
  update private_profiles set strikes = greatest(0, least(strikes + coalesce(p_delta, 0), 99)) where id = p_user returning strikes into s;
  perform _log_admin(me, p_user, case when p_delta > 0 then 'strike added' else 'strike removed' end, 'now ' || s || coalesce(' - ' || nullif(btrim(p_reason), ''), ''));
  return s;
end $$;

create function public.admin_suspend(p_user uuid, p_days int, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _admin_target(p_user); r text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_days is null or p_days < 1 or p_days > 365 then raise exception 'Suspension must be 1 to 365 days'; end if;
  update private_profiles set suspended_until = now() + make_interval(days => p_days), suspended_reason = r where id = p_user;
  perform _cancel_user_listings(p_user);
  perform _log_admin(me, p_user, 'suspended', p_days || ' days' || coalesce(' - ' || r, ''));
end $$;

create function public.admin_unsuspend(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _admin_target(p_user);
begin
  update private_profiles set suspended_until = null, suspended_reason = null where id = p_user;
  perform _log_admin(me, p_user, 'suspension lifted', null);
end $$;

create function public.admin_ban(p_user uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _admin_target(p_user); r text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  update private_profiles set banned = true, banned_reason = r where id = p_user;
  perform _cancel_user_listings(p_user);
  perform _log_admin(me, p_user, 'banned', r);
end $$;

create function public.admin_unban(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := _admin_target(p_user);
begin
  update private_profiles set banned = false, banned_reason = null where id = p_user;
  perform _log_admin(me, p_user, 'unbanned', null);
end $$;

-- Delete a user. Someone with no trading history is removed completely.
-- Someone with listings, bids or reports is anonymised instead (their deals stay in other people's order history and receipts)
-- and stays permanently blocked. Returns 'deleted' or 'anonymised'.
create function public.admin_delete_user(p_user uuid) returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := _admin_target(p_user); nm text; hist boolean;
begin
  if exists (select 1 from listings where status = 'reserved' and (seller_id = p_user or buyer_id = p_user)) then
    raise exception 'This user has a deal on hold. Release or complete it first';
  end if;
  if exists (select 1 from listings where status = 'active' and type = 'auction' and coalesce(bid_count, 0) > 0 and (seller_id = p_user or current_bidder = p_user)) then
    raise exception 'This user is in an auction with bids. Wait for it to end or cancel it first';
  end if;
  select display_name into nm from profiles where id = p_user;
  perform _cancel_user_listings(p_user);
  hist := exists (select 1 from listings where seller_id = p_user or buyer_id = p_user or current_bidder = p_user)
       or exists (select 1 from bids where bidder_id = p_user)
       or exists (select 1 from reports where reporter_id = p_user)
       or exists (select 1 from membership_requests where user_id = p_user);
  if not hist then
    perform _log_admin(me, p_user, 'deleted', 'removed completely');
    delete from auth.users where id = p_user;
    return 'deleted';
  end if;
  update profiles set display_name = 'Deleted user', avatar_url = null where id = p_user;
  update private_profiles set whatsapp = null, member_until = null, banned = true, banned_reason = 'Account deleted', suspended_until = null, suspended_reason = null where id = p_user;
  delete from inventory where user_id = p_user;
  delete from user_tags where user_id = p_user;
  begin delete from inventory_shares where user_id = p_user; exception when undefined_table then null; end;
  begin delete from auth.sessions where user_id = p_user; exception when undefined_table then null; end;
  insert into admin_actions(admin_id, user_id, user_name, action, detail) values (me, p_user, nm, 'deleted', 'anonymised: trading history kept');
  return 'anonymised';
end $$;
