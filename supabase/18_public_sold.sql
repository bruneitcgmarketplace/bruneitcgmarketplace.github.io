-- 18_public_sold.sql: public "Sold cards" board. Anyone (even signed out) can read sold deals with the final price.
-- Real names never leave the database: buyer and seller are masked to the first 2 and last 2 characters.
-- No listing, user or contact ids are returned.

create or replace function public.mask_name(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when p is null or btrim(p) = '' then '***'
    when char_length(btrim(p)) <= 4 then left(btrim(p), 1) || '***'   -- too short to show 4 letters safely
    else left(btrim(p), 2) || '***' || right(btrim(p), 2)
  end
$$;

create or replace function public.public_sold(p_limit int default 1000, p_offset int default 0)
returns table (
  card_ref text, card_code text, card_name text, rarity text, set_id text, catalog_image text, photo text,
  condition text, language text, type text, price numeric, listing_price numeric,
  sold_at timestamptz, seller_name text, buyer_name text)
language sql stable security definer set search_path = public as $$
  select l.card_ref, l.card_code, l.card_name, l.rarity, l.set_id, l.catalog_image, l.photos[1],
         l.condition, l.language, l.type,
         coalesce(l.agreed_price, case when l.type = 'auction' then coalesce(l.current_bid, l.start_price) else l.price end),
         case when l.type = 'auction' then coalesce(l.current_bid, l.start_price) else l.price end,
         coalesce(l.sold_at, l.created_at),
         public.mask_name(s.display_name), public.mask_name(b.display_name)
  from public.listings l
  join public.profiles s on s.id = l.seller_id
  left join public.profiles b on b.id = l.buyer_id
  where l.status = 'sold'
  order by coalesce(l.sold_at, l.created_at) desc, l.id
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function public.public_sold_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('n', count(*), 'n7', count(*) filter (where coalesce(sold_at, created_at) >= now() - interval '7 days'))
  from public.listings where status = 'sold'
$$;

revoke all on function public.public_sold(int, int) from public;
revoke all on function public.public_sold_summary() from public;
grant execute on function public.mask_name(text) to anon, authenticated;
grant execute on function public.public_sold(int, int) to anon, authenticated;
grant execute on function public.public_sold_summary() to anon, authenticated;
