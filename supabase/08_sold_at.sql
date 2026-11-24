-- Sale receipt: record when a listing was marked sold (used on the PDF receipt).
alter table public.listings add column if not exists sold_at timestamptz;

-- Same as 03_inventory.sql mark_sold, plus sold_at.
create or replace function public.mark_sold(p_listing uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); l listings;
begin
  select * into l from listings where id = p_listing for update;
  if not found or l.seller_id <> me then raise exception 'Not your listing'; end if;
  if l.status <> 'reserved' then raise exception 'Only reserved listings can be marked sold'; end if;
  update listings set status = 'sold', sold_at = now() where id = l.id;
  if l.card_ref is not null then
    delete from inventory where user_id = me and card_ref = l.card_ref and qty <= 1;
    update inventory set qty = qty - 1, updated_at = now() where user_id = me and card_ref = l.card_ref;
  end if;
end $$;
