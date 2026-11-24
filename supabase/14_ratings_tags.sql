-- User ratings after a completed deal, and admin-assigned tags (verified, moderator, ...).

-- ---------- ratings ----------
-- One rating per person per sold listing: the buyer rates the seller and the seller rates the buyer.
create table public.ratings (
  id bigint generated always as identity primary key,
  listing_id uuid not null references public.listings(id) on delete cascade,
  rater_id uuid not null references public.profiles(id) on delete cascade,
  ratee_id uuid not null references public.profiles(id) on delete cascade,
  stars int not null check (stars between 1 and 5),
  comment text check (char_length(comment) <= 300),
  created_at timestamptz not null default now(),
  unique (listing_id, rater_id),
  check (rater_id <> ratee_id)
);
create index ratings_ratee_idx on public.ratings(ratee_id, created_at desc);
alter table public.ratings enable row level security;
create policy ratings_read on public.ratings for select using (true);   -- public; writes only through rate_user()

create function public.rate_user(p_listing uuid, p_stars int, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); l listings; other uuid; c text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  select * into l from listings where id = p_listing;
  if not found then raise exception 'Listing not found'; end if;
  if l.status <> 'sold' then raise exception 'You can rate after the deal is marked as sold'; end if;
  if me = l.seller_id then other := l.buyer_id;
  elsif me = l.buyer_id then other := l.seller_id;
  else raise exception 'Only the buyer or the seller can rate this deal'; end if;
  if other is null then raise exception 'This deal has no other party to rate'; end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then raise exception 'Choose 1 to 5 stars'; end if;
  if c is not null and char_length(c) > 300 then raise exception 'Comment is too long (300 characters)'; end if;
  if exists (select 1 from ratings where listing_id = p_listing and rater_id = me) then raise exception 'You already rated this deal'; end if;
  insert into ratings(listing_id, rater_id, ratee_id, stars, comment) values (p_listing, me, other, p_stars, c);
end $$;

create view public.rating_summary as
  select ratee_id, round(avg(stars)::numeric, 2) as avg, count(*)::int as n from public.ratings group by ratee_id;
grant select on public.rating_summary to anon, authenticated;

create function public.admin_delete_rating(p_rating bigint) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user();
begin
  if not is_admin(me) then raise exception 'Admin only'; end if;
  delete from ratings where id = p_rating;
end $$;

-- ---------- tags ----------
create table public.user_tags (
  user_id uuid not null references public.profiles(id) on delete cascade,
  tag text not null check (tag in ('verified', 'moderator', 'trusted', 'vip')),
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, tag)
);
alter table public.user_tags enable row level security;
create policy user_tags_read on public.user_tags for select using (true);   -- public labels; writes only through set_user_tag()

create function public.set_user_tag(p_user uuid, p_tag text, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user();
begin
  if not is_admin(me) then raise exception 'Admin only'; end if;
  if p_tag not in ('verified', 'moderator', 'trusted', 'vip') then raise exception 'Unknown tag'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'User not found'; end if;
  if p_on then insert into user_tags(user_id, tag, granted_by) values (p_user, p_tag, me) on conflict do nothing;
  else delete from user_tags where user_id = p_user and tag = p_tag; end if;
end $$;
