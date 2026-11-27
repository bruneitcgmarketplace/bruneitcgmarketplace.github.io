-- Manual listings: sealed packs, booster boxes, cases, graded slabs, promo/other cards that are not in the catalogue.
-- kind='card' keeps the old behaviour (catalogue card). Any other kind has no card_ref and needs a photo.
alter table listings add column if not exists kind text not null default 'card';
alter table listings drop constraint if exists listings_kind_check;
alter table listings add constraint listings_kind_check check (kind in ('card','promo','pack','box','case','slab','other'));

create or replace function public.create_listing(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  me uuid := require_user();
  pp private_profiles;
  t text := p->>'type';
  k text := coalesce(nullif(p->>'kind',''), 'card');
  hours int;
  new_id uuid;
  ref text := p->>'card_ref';
  code text := p->>'card_code';
  nm text := p->>'card_name';
  ph text[] := coalesce(array(select jsonb_array_elements_text(p->'photos')), '{}');
begin
  select * into pp from private_profiles where id = me;
  if pp.strikes >= 3 then raise exception 'Your account is blocked from listing (3 strikes)'; end if;
  if pp.whatsapp is null then raise exception 'Add your WhatsApp number before listing'; end if;
  if t not in ('buy_now','auction') then raise exception 'Invalid listing type'; end if;
  if k not in ('card','promo','pack','box','case','slab','other') then raise exception 'Invalid item type'; end if;
  if t = 'auction' and not is_member(me) then
    raise exception 'Auction listings need a paid membership';
  end if;
  if k = 'card' then
    if coalesce(code,'') = '' or coalesce(nm,'') = '' then raise exception 'Pick a card first'; end if;
  else
    -- manual item: not tied to the catalogue
    nm := left(btrim(coalesce(nm,'')), 120);
    if nm = '' then raise exception 'Enter a name for the item'; end if;
    if cardinality(ph) < 1 then raise exception 'Add at least one photo of the item'; end if;
    if cardinality(ph) > 4 then raise exception 'Up to 4 photos'; end if;
    ref := null;
    code := left(coalesce(nullif(btrim(coalesce(code,'')),''), case k when 'pack' then 'PACK' when 'box' then 'BOX' when 'case' then 'CASE' when 'slab' then 'SLAB' when 'promo' then 'PROMO' else 'ITEM' end), 30);
  end if;
  if t = 'buy_now' then
    insert into listings(seller_id, type, kind, card_ref, card_code, card_name, rarity, set_id, catalog_image,
                         photos, condition, language, description, price)
    values (me, t, k, ref, code, nm, left(p->>'rarity', 40), case when k = 'card' then p->>'set_id' else null end,
            case when k = 'card' then p->>'catalog_image' else null end, ph,
            coalesce(p->>'condition','NM'), coalesce(p->>'language','JP'), left(p->>'description', 1000),
            (p->>'price')::numeric)
    returning id into new_id;
  else
    hours := coalesce((p->>'duration_hours')::int, 72);
    if hours < 1 or hours > 168 then raise exception 'Auction length must be 1 to 168 hours'; end if;
    insert into listings(seller_id, type, kind, card_ref, card_code, card_name, rarity, set_id, catalog_image,
                         photos, condition, language, description, start_price, bid_increment, ends_at)
    values (me, t, k, ref, code, nm, left(p->>'rarity', 40), case when k = 'card' then p->>'set_id' else null end,
            case when k = 'card' then p->>'catalog_image' else null end, ph,
            coalesce(p->>'condition','NM'), coalesce(p->>'language','JP'), left(p->>'description', 1000),
            (p->>'start_price')::numeric, coalesce((p->>'bid_increment')::numeric, 1),
            now() + make_interval(hours => hours))
    returning id into new_id;
  end if;
  return new_id;
end $$;
