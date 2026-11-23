-- Share your inventory with other users through a revocable link. The link shows a read-only list (card + quantity)
-- with the owner's display name and avatar. No contact details, no prices set by the owner.

create table public.inventory_shares (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);
alter table public.inventory_shares enable row level security;
-- no policies: all access goes through the functions below

-- Create (or return the existing) share link token for the signed-in user.
create function public.share_inventory() returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); t text;
begin
  select token into t from inventory_shares where user_id = me;
  if t is null then
    t := replace(gen_random_uuid()::text, '-', '');
    insert into inventory_shares(user_id, token) values (me, t);
  end if;
  return t;
end $$;

-- Current token or null (is my inventory shared?).
create function public.my_inventory_share() returns text
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user();
begin
  return (select token from inventory_shares where user_id = me);
end $$;

-- Stop sharing: the old link stops working.
create function public.unshare_inventory() returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user();
begin
  delete from inventory_shares where user_id = me;
end $$;

-- Public read of a shared inventory by token (callable without signing in).
create function public.get_shared_inventory(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid; p profiles;
begin
  select user_id into uid from inventory_shares where token = p_token;
  if uid is null then raise exception 'This share link is not valid or was turned off'; end if;
  select * into p from profiles where id = uid;
  return jsonb_build_object(
    'owner', p.display_name,
    'avatar', p.avatar_url,
    'items', coalesce((select jsonb_agg(jsonb_build_object('card_ref', card_ref, 'qty', qty) order by card_ref)
                         from inventory where user_id = uid), '[]'::jsonb));
end $$;

revoke all on function public.share_inventory(), public.my_inventory_share(), public.unshare_inventory() from public, anon;
grant execute on function public.share_inventory(), public.my_inventory_share(), public.unshare_inventory() to authenticated;
grant execute on function public.get_shared_inventory(text) to anon, authenticated;
