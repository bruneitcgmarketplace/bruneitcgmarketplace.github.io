-- Agreed sale price: when marking a buy-now card as sold, the seller may enter the price agreed after negotiation.
-- Empty = sold at the listing price (agreed_price stays null). An entry equal to the listing price is stored as null too.
alter table public.listings add column if not exists agreed_price numeric(10,2) check (agreed_price > 0);

-- Replaces mark_sold(uuid) (03 + 08). Keeps the sold_at stamp and the inventory deduction.
drop function if exists public.mark_sold(uuid);
create or replace function public.mark_sold(p_listing uuid, p_agreed_price numeric default null) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); l listings; ap numeric(10,2);
begin
  select * into l from listings where id = p_listing for update;
  if not found or l.seller_id <> me then raise exception 'Not your listing'; end if;
  if l.status <> 'reserved' then raise exception 'Only reserved listings can be marked sold'; end if;
  if p_agreed_price is not null then
    if l.type <> 'buy_now' then raise exception 'An agreed price can only be entered for a buy-now listing'; end if;
    if p_agreed_price > 99999999 then raise exception 'Enter a valid agreed price'; end if;
    ap := round(p_agreed_price, 2);
    if ap <= 0 then raise exception 'The agreed price must be above 0'; end if;
    if ap = l.price then ap := null; end if;
  end if;
  update listings set status = 'sold', sold_at = now(), agreed_price = ap where id = l.id;
  if l.card_ref is not null then
    delete from inventory where user_id = me and card_ref = l.card_ref and qty <= 1;
    update inventory set qty = qty - 1, updated_at = now() where user_id = me and card_ref = l.card_ref;
  end if;
end $$;
