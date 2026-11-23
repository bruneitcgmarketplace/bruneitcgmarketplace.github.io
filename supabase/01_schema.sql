-- Brunei TCG Marketplace: schema, RLS and RPCs (run in Supabase SQL editor)
-- All writes to listings/bids go through security-definer functions; clients cannot write those tables directly.

-- ---------- Profiles ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Collector',
  avatar_url text,
  created_at timestamptz not null default now()
);

-- Private fields: visible only to the owner (and via get_contact to a deal counterparty)
create table public.private_profiles (
  id uuid primary key references public.profiles(id) on delete cascade,
  whatsapp text,
  member_until timestamptz,
  strikes int not null default 0,
  is_admin boolean not null default false
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id, display_name, avatar_url)
  values (new.id,
          coalesce(nullif(new.raw_user_meta_data->>'full_name',''), split_part(new.email,'@',1), 'Collector'),
          new.raw_user_meta_data->>'avatar_url');
  insert into public.private_profiles(id) values (new.id);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.is_member(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select member_until > now() from private_profiles where id = uid), false)
$$;

create function public.is_admin(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from private_profiles where id = uid), false)
$$;

-- ---------- Listings and bids ----------
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id),
  type text not null check (type in ('buy_now','auction')),
  card_ref text,
  card_code text not null,
  card_name text not null,
  rarity text,
  set_id text,
  catalog_image text,
  photos text[] not null default '{}',
  condition text not null default 'NM' check (condition in ('M','NM','LP','MP','HP')),
  language text not null default 'JP',
  description text,
  price numeric(10,2) check (price > 0),
  start_price numeric(10,2) check (start_price > 0),
  bid_increment numeric(10,2) not null default 1 check (bid_increment > 0),
  current_bid numeric(10,2),
  current_bidder uuid references public.profiles(id),
  bid_count int not null default 0,
  ends_at timestamptz,
  status text not null default 'active' check (status in ('active','reserved','sold','ended','cancelled')),
  buyer_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint type_fields check (
    (type = 'buy_now' and price is not null) or
    (type = 'auction' and start_price is not null and ends_at is not null))
);
create index listings_status_idx on public.listings(status, created_at desc);
create index listings_seller_idx on public.listings(seller_id);
create index listings_code_idx on public.listings(card_code);

create table public.bids (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.listings(id) on delete cascade,
  bidder_id uuid not null references public.profiles(id),
  amount numeric(10,2) not null,
  created_at timestamptz not null default now()
);
create index bids_listing_idx on public.bids(listing_id, amount desc);

create table public.membership_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id),
  reference text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table public.reports (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.listings(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id),
  reason text not null check (char_length(reason) between 3 and 500),
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.private_profiles enable row level security;
alter table public.listings enable row level security;
alter table public.bids enable row level security;
alter table public.membership_requests enable row level security;
alter table public.reports enable row level security;

create policy profiles_read on public.profiles for select using (true);
create policy profiles_update_own on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (display_name) on public.profiles to authenticated;

create policy private_read_own on public.private_profiles for select using (id = auth.uid());

create policy listings_read on public.listings for select using (true);
create policy bids_read on public.bids for select using (true);

create policy mr_read on public.membership_requests for select
  using (user_id = auth.uid() or public.is_admin(auth.uid()));

create policy reports_insert on public.reports for insert with check (reporter_id = auth.uid());
create policy reports_read_admin on public.reports for select using (public.is_admin(auth.uid()));

-- ---------- Helper ----------
create function public.require_user() returns uuid language plpgsql stable as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first'; end if;
  return me;
end $$;

-- ---------- Profile RPCs ----------
create function public.set_whatsapp(p_number text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); n text := regexp_replace(coalesce(p_number,''), '[^0-9]', '', 'g');
begin
  if char_length(n) < 7 or char_length(n) > 15 then
    raise exception 'Enter a valid WhatsApp number with country code, e.g. 6737123456';
  end if;
  update private_profiles set whatsapp = n where id = me;
end $$;

-- Contact is only shared between seller and buyer once a deal is reserved/sold
create function public.get_contact(p_listing uuid) returns table(role text, display_name text, whatsapp text)
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); l listings;
begin
  select * into l from listings where id = p_listing;
  if not found or l.status not in ('reserved','sold') or l.buyer_id is null then return; end if;
  if me = l.seller_id then
    return query select 'buyer'::text, p.display_name, pp.whatsapp
      from profiles p join private_profiles pp on pp.id = p.id where p.id = l.buyer_id;
  elsif me = l.buyer_id then
    return query select 'seller'::text, p.display_name, pp.whatsapp
      from profiles p join private_profiles pp on pp.id = p.id where p.id = l.seller_id;
  end if;
end $$;

-- ---------- Listing RPCs ----------
create function public.create_listing(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := require_user();
  pp private_profiles;
  t text := p->>'type';
  hours int;
  new_id uuid;
begin
  select * into pp from private_profiles where id = me;
  if pp.strikes >= 3 then raise exception 'Your account is blocked from listing (3 strikes)'; end if;
  if pp.whatsapp is null then raise exception 'Add your WhatsApp number before listing'; end if;
  if t not in ('buy_now','auction') then raise exception 'Invalid listing type'; end if;
  if t = 'auction' and not is_member(me) then
    raise exception 'Auction listings need a paid membership';
  end if;
  if coalesce(p->>'card_code','') = '' or coalesce(p->>'card_name','') = '' then
    raise exception 'Pick a card first';
  end if;
  if (select count(*) from listings where seller_id = me and status = 'active') >= 100 then
    raise exception 'Too many active listings';
  end if;

  if t = 'buy_now' then
    insert into listings(seller_id, type, card_ref, card_code, card_name, rarity, set_id, catalog_image,
                         photos, condition, language, description, price)
    values (me, t, p->>'card_ref', p->>'card_code', p->>'card_name', p->>'rarity', p->>'set_id', p->>'catalog_image',
            coalesce(array(select jsonb_array_elements_text(p->'photos')), '{}'),
            coalesce(p->>'condition','NM'), coalesce(p->>'language','JP'), left(p->>'description', 1000),
            (p->>'price')::numeric)
    returning id into new_id;
  else
    hours := coalesce((p->>'duration_hours')::int, 72);
    if hours < 1 or hours > 168 then raise exception 'Auction length must be 1 to 168 hours'; end if;
    insert into listings(seller_id, type, card_ref, card_code, card_name, rarity, set_id, catalog_image,
                         photos, condition, language, description, start_price, bid_increment, ends_at)
    values (me, t, p->>'card_ref', p->>'card_code', p->>'card_name', p->>'rarity', p->>'set_id', p->>'catalog_image',
            coalesce(array(select jsonb_array_elements_text(p->'photos')), '{}'),
            coalesce(p->>'condition','NM'), coalesce(p->>'language','JP'), left(p->>'description', 1000),
            (p->>'start_price')::numeric, coalesce((p->>'bid_increment')::numeric, 1),
            now() + make_interval(hours => hours))
    returning id into new_id;
  end if;
  return new_id;
end $$;

create function public.cancel_listing(p_listing uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); l listings;
begin
  select * into l from listings where id = p_listing for update;
  if not found or l.seller_id <> me then raise exception 'Not your listing'; end if;
  if l.status <> 'active' then raise exception 'Only active listings can be cancelled'; end if;
  if l.bid_count > 0 then raise exception 'Auctions with bids cannot be cancelled'; end if;
  update listings set status = 'cancelled' where id = l.id;
end $$;

create function public.buy_now(p_listing uuid) returns listings
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); l listings;
begin
  if (select strikes from private_profiles where id = me) >= 3 then
    raise exception 'Your account is blocked from buying (3 strikes)';
  end if;
  if (select whatsapp from private_profiles where id = me) is null then
    raise exception 'Add your WhatsApp number first so the seller can contact you';
  end if;
  select * into l from listings where id = p_listing for update;
  if not found then raise exception 'Listing not found'; end if;
  if l.type <> 'buy_now' then raise exception 'This is an auction'; end if;
  if l.seller_id = me then raise exception 'You cannot buy your own listing'; end if;
  if l.status <> 'active' then raise exception 'Already reserved or sold'; end if;
  update listings set status = 'reserved', buyer_id = me where id = l.id returning * into l;
  return l;
end $$;

-- Buyer backs out of a buy-now reservation
create function public.cancel_reservation(p_listing uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); l listings;
begin
  select * into l from listings where id = p_listing for update;
  if not found or l.buyer_id is distinct from me or l.status <> 'reserved' or l.type <> 'buy_now' then
    raise exception 'Nothing to cancel';
  end if;
  update listings set status = 'active', buyer_id = null where id = l.id;
end $$;

create function public.mark_sold(p_listing uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); l listings;
begin
  select * into l from listings where id = p_listing for update;
  if not found or l.seller_id <> me then raise exception 'Not your listing'; end if;
  if l.status <> 'reserved' then raise exception 'Only reserved listings can be marked sold'; end if;
  update listings set status = 'sold' where id = l.id;
end $$;

-- Seller releases a reservation. no_show=true gives the buyer a strike.
create function public.seller_release(p_listing uuid, p_no_show boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); l listings;
begin
  select * into l from listings where id = p_listing for update;
  if not found or l.seller_id <> me then raise exception 'Not your listing'; end if;
  if l.status <> 'reserved' then raise exception 'Nothing to release'; end if;
  if p_no_show and l.buyer_id is not null then
    update private_profiles set strikes = strikes + 1 where id = l.buyer_id;
  end if;
  if l.type = 'buy_now' then
    update listings set status = 'active', buyer_id = null where id = l.id;
  else
    update listings set status = 'ended', buyer_id = null where id = l.id;
  end if;
end $$;

-- ---------- Bidding ----------
create function public.place_bid(p_listing uuid, p_amount numeric) returns listings
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); l listings; minbid numeric;
begin
  if (select strikes from private_profiles where id = me) >= 3 then
    raise exception 'Your account is blocked from bidding (3 strikes)';
  end if;
  select * into l from listings where id = p_listing for update;
  if not found then raise exception 'Listing not found'; end if;
  if l.type <> 'auction' then raise exception 'This is not an auction'; end if;
  if l.status <> 'active' or l.ends_at <= now() then raise exception 'Auction has ended'; end if;
  if l.seller_id = me then raise exception 'You cannot bid on your own auction'; end if;
  if l.current_bidder = me then raise exception 'You are already the highest bidder'; end if;
  minbid := case when l.current_bid is null then l.start_price else l.current_bid + l.bid_increment end;
  if p_amount is null or p_amount < minbid then
    raise exception 'Minimum bid is BND %', minbid;
  end if;
  insert into bids(listing_id, bidder_id, amount) values (l.id, me, p_amount);
  update listings set
    current_bid = p_amount, current_bidder = me, bid_count = bid_count + 1,
    ends_at = case when ends_at - now() < interval '2 minutes' then now() + interval '2 minutes' else ends_at end
  where id = l.id returning * into l;
  return l;
end $$;

-- Idempotent; clients call it on page load, and pg_cron (if enabled) calls it every minute
create function public.close_ended_auctions() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update listings set
    status = case when current_bidder is null then 'ended' else 'reserved' end,
    buyer_id = current_bidder
  where type = 'auction' and status = 'active' and ends_at <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Membership ----------
create function public.request_membership(p_reference text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user();
begin
  if char_length(coalesce(trim(p_reference),'')) < 3 then raise exception 'Enter your bank transfer reference'; end if;
  if exists (select 1 from membership_requests where user_id = me and status = 'pending') then
    raise exception 'You already have a pending request';
  end if;
  insert into membership_requests(user_id, reference) values (me, trim(p_reference));
end $$;

create function public.admin_approve_membership(p_request bigint, p_days int default 30) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); r membership_requests;
begin
  if not is_admin(me) then raise exception 'Admin only'; end if;
  select * into r from membership_requests where id = p_request and status = 'pending' for update;
  if not found then raise exception 'Request not found or already decided'; end if;
  update private_profiles
    set member_until = greatest(coalesce(member_until, now()), now()) + make_interval(days => p_days)
    where id = r.user_id;
  update membership_requests set status = 'approved', decided_at = now() where id = r.id;
end $$;

create function public.admin_reject_membership(p_request bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user();
begin
  if not is_admin(me) then raise exception 'Admin only'; end if;
  update membership_requests set status = 'rejected', decided_at = now() where id = p_request and status = 'pending';
end $$;

create function public.admin_cancel_listing(p_listing uuid, p_report bigint default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user();
begin
  if not is_admin(me) then raise exception 'Admin only'; end if;
  update listings set status = 'cancelled', buyer_id = null where id = p_listing and status in ('active','reserved');
  if p_report is not null then update reports set resolved = true where id = p_report; end if;
end $$;

create function public.admin_resolve_report(p_report bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin(require_user()) then raise exception 'Admin only'; end if;
  update reports set resolved = true where id = p_report;
end $$;

-- ---------- Realtime and cron (both optional) ----------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.listings, public.bids;
  end if;
end $$;

-- To enable per-minute auction closing: Dashboard > Database > Extensions > pg_cron, then:
--   select cron.schedule('close-auctions', '* * * * *', 'select public.close_ended_auctions()');
-- To make yourself admin after first login:
--   update public.private_profiles set is_admin = true where id = (select id from auth.users where email = 'YOUR_EMAIL');
