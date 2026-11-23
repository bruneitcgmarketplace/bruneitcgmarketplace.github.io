-- Personal card inventory (collection). Owner-only access; selling a card deducts one copy.

create table public.inventory (
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_ref text not null,                      -- '<set>-<yuyutei id>', same as listings.card_ref
  qty int not null check (qty > 0 and qty <= 9999),
  updated_at timestamptz not null default now(),
  primary key (user_id, card_ref)
);

alter table public.inventory enable row level security;
create policy inv_select on public.inventory for select using (user_id = auth.uid());
create policy inv_insert on public.inventory for insert with check (user_id = auth.uid());
create policy inv_update on public.inventory for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy inv_delete on public.inventory for delete using (user_id = auth.uid());

-- Add (or subtract with a negative delta) copies; removes the row at zero. Returns the new quantity.
create function public.inventory_adjust(p_card_ref text, p_delta int) returns int
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); q int;
begin
  if coalesce(p_card_ref, '') = '' then raise exception 'Card required'; end if;
  select qty into q from inventory where user_id = me and card_ref = p_card_ref for update;
  if not found then
    if p_delta <= 0 then return 0; end if;
    insert into inventory(user_id, card_ref, qty) values (me, p_card_ref, least(p_delta, 9999));
    return least(p_delta, 9999);
  end if;
  q := q + p_delta;
  if q <= 0 then
    delete from inventory where user_id = me and card_ref = p_card_ref;
    return 0;
  end if;
  update inventory set qty = least(q, 9999), updated_at = now() where user_id = me and card_ref = p_card_ref;
  return least(q, 9999);
end $$;

-- mark_sold now also deducts one copy from the seller's inventory (if they track it)
create or replace function public.mark_sold(p_listing uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := require_user(); l listings;
begin
  select * into l from listings where id = p_listing for update;
  if not found or l.seller_id <> me then raise exception 'Not your listing'; end if;
  if l.status <> 'reserved' then raise exception 'Only reserved listings can be marked sold'; end if;
  update listings set status = 'sold' where id = l.id;
  if l.card_ref is not null then
    delete from inventory where user_id = me and card_ref = l.card_ref and qty <= 1;
    update inventory set qty = qty - 1, updated_at = now() where user_id = me and card_ref = l.card_ref;
  end if;
end $$;
